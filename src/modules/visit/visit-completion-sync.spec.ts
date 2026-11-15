import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { LeadRepository } from '../lead/lead.repository';
import { MobileVisitController } from './mobile-visit.controller';

describe('Assigned visit completion synchronization', () => {
  let db: any, controller: MobileVisitController, visit: any, lead: any;
  const user = {id: 8, role: 'VISITOR'};
  beforeEach(() => {
    visit = {id: 30, customerId: 2, leadId: 10, employeeId: 7, status: 'IN_PROGRESS', createdAt: new Date(), lead: {employeeId: 9}};
    lead = {id:10,customerId:2,status:'VISIT_SCHEDULED',stageId:4,stage:{id:4,key:'VISIT_SCHEDULED',name:'Visit Scheduled'}};
    db = {
      $queryRaw:jest.fn(),
      employee:{findFirst:jest.fn().mockResolvedValue({id:7,userId:8,customerId:2,status:'ACTIVE',designation:{name:'Visitor'},firstName:'Assigned',lastName:'Visitor'})},
      visit:{findUnique:jest.fn(async()=>visit),findFirst:jest.fn(async()=>visit),update:jest.fn(async({data})=>(visit={...visit,...data})),create:jest.fn()},
      lead:{findFirst:jest.fn(async()=>lead),findUnique:jest.fn(async()=>lead),updateMany:jest.fn(async({data})=>{Object.assign(lead,data);return {count:1};})},
      leadStage:{findFirst:jest.fn(async({where})=>JSON.stringify(where).includes('VISIT_DONE')?{id:5,key:'VISIT_DONE',name:'Visit Done'}:{id:4,key:'VISIT_SCHEDULED',name:'Visit Scheduled'})},
      leadActivityTimeline:{create:jest.fn().mockResolvedValue({id:1})},
      leadStatusHistory:{create:jest.fn().mockResolvedValue({id:2})},
    };
    db.$transaction=jest.fn(async fn=>{const beforeVisit={...visit},beforeLead={...lead};try{return await fn(db);}catch(e){visit=beforeVisit;lead=beforeLead;throw e;}});
    controller=new MobileVisitController({} as any,db,{} as any);
  });
  it('persists one assigned completion, moves the lead and lets BPO validate the same record',async()=>{
    const result=await controller.completeVisit(user,2,'30',{outcome:'Demo completed',notes:'Customer met'});
    expect(result).toMatchObject({id:30,status:'COMPLETED',completedById:7});
    expect(lead).toMatchObject({stageId:5,status:'VISIT_DONE'});
    expect(await new LeadRepository(db).requireCompletedAssignedVisit(2,10)).toMatchObject({id:30,completedById:7});
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.visit.findUnique.mock.invocationCallOrder[0]);
    expect(db.visit.update).toHaveBeenCalledTimes(1);
    expect(db.visit.create).not.toHaveBeenCalled();
    const originalDate=visit.completedAt;
    await controller.completeVisit(user,2,'30',{outcome:'Repeated'});
    expect(db.visit.update).toHaveBeenCalledTimes(1);
    expect(visit.completedAt).toBe(originalDate);
    expect(db.leadActivityTimeline.create.mock.calls.filter(([a])=>a.data.action==='VISIT_COMPLETED')).toHaveLength(1);
  });
  it.each(['wrongVisitor','unassigned','bpo','wrongTenant','cancelled','newerVisit'])('blocks %s without completion writes',async scenario=>{
    if(scenario==='wrongVisitor') db.employee.findFirst.mockResolvedValue({id:9,userId:8,customerId:2,status:'ACTIVE',designation:{name:'Visitor'}});
    if(scenario==='unassigned') visit.employeeId=null;
    if(scenario==='cancelled') visit.status='CANCELLED';
    if(scenario==='newerVisit') db.visit.findFirst.mockResolvedValue({...visit,id:31,status:'SCHEDULED'});
    if(scenario==='wrongTenant') visit.customerId=3;
    if(scenario==='bpo') db.employee.findFirst.mockResolvedValue({id:7,userId:8,customerId:2,status:'ACTIVE',designation:{name:'BPO'}});
    await expect(controller.completeVisit(scenario==='bpo'?{id:8,role:'BPO'}:user,2,'30',{notes:'Done'})).rejects.toThrow();
    expect(db.visit.update).not.toHaveBeenCalled();
  });
  it('checks identity before returning an already-completed record',async()=>{
    Object.assign(visit,{status:'COMPLETED',completedById:7,completedAt:new Date()});
    db.employee.findFirst.mockResolvedValue({id:9,userId:8,customerId:2,status:'ACTIVE',designation:{name:'Visitor'}});
    await expect(controller.completeVisit(user,2,'30',{})).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each(['SCHEDULED','IN_PROGRESS','CANCELLED'])('BPO cannot recognize an incomplete/latest %s visit',async status=>{
    Object.assign(visit,{status,completedById:7,completedAt:new Date()});
    await expect(new LeadRepository(db).requireCompletedAssignedVisit(2,10)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it.each([{completedById:9},{completedAt:null},{leadId:11},{customerId:3}])('rejects mismatched completion proof %j',async change=>{
    Object.assign(visit,{status:'COMPLETED',completedById:7,completedAt:new Date()},change);
    await expect(new LeadRepository(db).requireCompletedAssignedVisit(2,10)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects a missing completion record', async()=>{
    db.visit.findFirst.mockResolvedValue(null);
    await expect(new LeadRepository(db).requireCompletedAssignedVisit(2,10)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rolls back the visit and stage when completion evidence cannot be saved', async()=>{
    db.leadActivityTimeline.create.mockImplementation(async({data})=>{if(data.action==='VISIT_COMPLETED')throw new Error('timeline unavailable');return {id:1};});
    await expect(controller.completeVisit(user,2,'30',{notes:'Done'})).rejects.toThrow('timeline unavailable');
    expect(visit.status).toBe('IN_PROGRESS');
    expect(lead.status).toBe('VISIT_SCHEDULED');
  });
  it('rolls completion back if Visit Done is not configured',async()=>{
    db.leadStage.findFirst.mockImplementation(async({where})=>JSON.stringify(where).includes('VISIT_DONE')?null:{id:4,key:'VISIT_SCHEDULED',name:'Visit Scheduled'});
    await expect(controller.completeVisit(user,2,'30',{notes:'Done'})).rejects.toBeInstanceOf(BadRequestException);
    expect(visit.status).toBe('IN_PROGRESS');
    expect(lead.status).toBe('VISIT_SCHEDULED');
  });
});
