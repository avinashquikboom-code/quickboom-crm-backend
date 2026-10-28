import { LeadRepository } from './lead.repository';
import { LeadService } from './lead.service';
import { VisitorLeadActionsGuard } from './visitor-lead-actions.guard';
import { ForbiddenException } from '@nestjs/common';

// These are isolated fixture identifiers, never production stage/employee IDs.
const stages = ['NEW', 'CONTACTED', 'DETAILS_SENT', 'FOLLOW_UP', 'VISIT_SCHEDULED', 'VISIT_DONE', 'PROPOSAL_SENT', 'NEGOTIATION', 'FINAL_CALL', 'WON', 'LOST'].map((key, i) => ({id:101+i,key,name:key,customerId:7,deletedAt:null,isActive:true}));
const scheduled = stages.find(s => s.key === 'VISIT_SCHEDULED')!;
const done = stages.find(s => s.key === 'VISIT_DONE')!;
const admin = {id:1,role:'ADMIN',customerId:7};
const visitor = {id:21,role:'VISITOR',customerId:7};
function match(row: any, where: any): boolean {
  return Object.entries(where || {}).every(([key,value]: [string,any]) => {
    if (key === 'OR') return value.some((v:any) => match(row,v));
    if (key === 'AND') return value.every((v:any) => match(row,v));
    if (value && typeof value === 'object') {
      if (value.in) return value.in.includes(row[key]);
      if (value.not !== undefined) return row[key] !== value.not;
      if (value.contains) return String(row[key] || '').toLowerCase().includes(value.contains.toLowerCase());
      if (value.equals !== undefined) return row[key] === value.equals;
    }
    return row[key] === value;
  });
}
function fixture() {
  const leads = stages.map((stage,i) => ({id:i+1,customerId:7,deletedAt:null,stageId:stage.id,stage,status:stage.key,companyName:`Fixture ${stage.key}`,firstName:'Contact',lastName:'Fixture'}));
  const visits:any[] = [];
  const employees:any[] = [{id:31,userId:21,customerId:7,status:'ACTIVE',mobileLoginEnabled:true,designation:{name:'Visitor'},user:{isActive:true}}];
  const prisma:any = {
    employee: {findFirst:jest.fn(async ({where}) => employees.find(e => match(e,where)) || null)},
    leadStage: {findFirst:jest.fn(async ({where}) => stages.find(s => match(s,where)) || null)},
    visit: {
      findMany:jest.fn(async () => [...new Map(visits.map(v=>[v.leadId,v] as const)).values()]),
      findFirst:jest.fn(async ({where}) => [...visits].reverse().find(v=>match(v,where)) || null),
    },
    lead: {
      findMany:jest.fn(async ({where,skip=0,take=100}) => leads.filter(l=>match(l,where)).slice(skip,skip+take)),
      count:jest.fn(async ({where}) => leads.filter(l=>match(l,where)).length),
    },
  };
  const repository = new LeadRepository(prisma);
  jest.spyOn(repository,'isVisitorUser').mockImplementation(async (user:any) => user?.role === 'VISITOR');
  jest.spyOn(repository,'resolveMissingLeadBusinessNames').mockResolvedValue(undefined);
  jest.spyOn(repository,'resolveMissingLeadVisitedAndWonEmployees').mockResolvedValue(undefined);
  return {prisma,repository,service:new LeadService(repository,prisma),leads,visits,employees};
}

describe('pipeline stage and Visitor assignment contract', () => {
  it.each(stages)('uses configured stage ID for $key and never matches a different authoritative stage', async stage => {
    const f=fixture();
    const result=await f.repository.findAll(7,{stageId:stage.id,page:1,limit:50},admin);
    expect(result.data.map(l=>l.stageId)).toEqual([stage.id]);
    expect(result.meta.total).toBe(1);
    expect(f.prisma.lead.count.mock.calls[0][0].where).toEqual(f.prisma.lead.findMany.mock.calls[0][0].where);
  });
  it('does not admit New records through the Visit Scheduled key or stage ID',async()=>{
    const f=fixture();
    f.leads[0].status='VISIT_SCHEDULED'; // mismatched legacy status cannot override a New stage.
    for(const query of [{status:'VISIT_SCHEDULED'},{stageId:scheduled.id}]) {
      const result=await f.repository.findAll(7,query,admin);
      expect(result.data.map(l=>l.stageId)).toEqual([scheduled.id]);
    }
  });
  it('keeps a legitimately scheduled New-stage lead in New rather than re-staging it',async()=>{
    const f=fixture(); f.visits.push({id:1,leadId:1,employeeId:31,customerId:7,status:'SCHEDULED'});
    const result=await f.repository.findAll(7,{stageId:scheduled.id},admin);
    expect(result.data.map(l=>l.id)).not.toContain(1);
    expect((await f.repository.findAll(7,{stageId:stages[0].id},admin)).data.map(l=>l.id)).toContain(1);
    expect((await f.repository.findAll(7,{},visitor)).data.map(l=>l.id)).toEqual([1]);
  });
  it('uses the newest persisted visit assignment; no unassigned or other-Visitor leads',async()=>{
    const f=fixture();
    f.visits.push({id:1,leadId:1,employeeId:31,customerId:7,status:'SCHEDULED'}, {id:2,leadId:1,employeeId:99,customerId:7,status:'SCHEDULED'}, {id:3,leadId:2,employeeId:31,customerId:7,status:'COMPLETED'}, {id:4,leadId:3,employeeId:31,customerId:7,status:'SCHEDULED'});
    expect((await f.repository.findAll(7,{},visitor)).data.map(l=>l.id)).toEqual([3]);
  });
  it('combines search, stage and pagination without changing total-count criteria',async()=>{
    const f=fixture();
    f.leads.push({...f.leads[4],id:100,companyName:'Fixture second'});
    const first=await f.repository.findAll(7,{stageId:scheduled.id,search:'Fixture',limit:1,page:1},admin);
    const second=await f.repository.findAll(7,{stageId:scheduled.id,search:'Fixture',limit:1,page:2},admin);
    expect(first.meta.total).toBe(2);expect(second.meta.total).toBe(2);
    expect(first.data[0].id).not.toBe(second.data[0].id);
    expect(first.data[0].stageId).toBe(scheduled.id);expect(second.data[0].stageId).toBe(scheduled.id);
  });
  it('rejects a stage from another tenant without broadening the result',async()=>{
    const f=fixture();expect((await f.repository.findAll(8,{stageId:scheduled.id},{...admin,customerId:8})).data).toEqual([]);
  });
  it('validates active, tenant-owned, authorized Visitor selection and forwards the selected ID',async()=>{
    const f=fixture();jest.spyOn(f.service,'getLeadById').mockResolvedValue(f.leads[0] as any);
    const persist=jest.spyOn(f.repository,'manageVisit').mockResolvedValue(f.leads[4] as any);
    const request:any={action:'SCHEDULE',employeeId:31,date:'2026-11-01',time:'10:30 AM'};
    await f.service.manageVisit(7,1,1,request,admin);
    expect(persist).toHaveBeenCalledWith(7,1,1,request);
    for(const invalid of [{status:'INACTIVE'},{customerId:8},{designation:{name:'BPO'}},{mobileLoginEnabled:false}]) {
      const old={...f.employees[0]};Object.assign(f.employees[0],invalid);
      await expect(f.service.manageVisit(7,1,1,request,admin)).rejects.toThrow();
      Object.assign(f.employees[0],old);
    }
    await expect(f.service.manageVisit(7,1,1,{...request,employeeId:undefined},admin)).rejects.toThrow();
    await expect(f.service.manageVisit(7,1,1,request,visitor)).rejects.toThrow(ForbiddenException);
  });
  it('denies direct lead access through lead ownership when the current visit belongs to someone else',async()=>{
    const f=fixture();jest.spyOn(f.repository,'findOne').mockResolvedValue({...f.leads[4],employeeId:31,assignedToId:21} as any);
    f.visits.push({id:1,leadId:5,employeeId:99,customerId:7,status:'SCHEDULED'});
    await expect(f.service.getLeadById(7,5,visitor)).rejects.toThrow(ForbiddenException);
  });
  it('Visitor cannot reassign, edit general lead fields, convert or complete a New-stage lead',async()=>{
    const f=fixture();
    await expect(f.service.updateLead(7,1,{employeeId:99} as any,21,visitor)).rejects.toThrow(ForbiddenException);
    await expect(f.service.convertLead(7,1,21,{} as any,visitor)).rejects.toThrow(ForbiddenException);
    jest.spyOn(f.service,'getLeadById').mockResolvedValue(f.leads[0] as any);
    await expect(f.service.manageVisit(7,1,21,{action:'COMPLETE'},visitor)).rejects.toThrow(ForbiddenException);
  });
  it('Visitor completion accepts only Visit Done, not VISIT, New or a custom stage carrying an old status',async()=>{
    const f=fixture();jest.spyOn(f.service,'getLeadById').mockResolvedValue(f.leads[4] as any);
    for(const target of ['NEW','VISIT','WON']) {
      await expect(f.service.updateStatus(7,5,21,{status:target} as any,visitor)).rejects.toThrow();
    }
    const persist=jest.spyOn(f.repository,'manageVisit').mockResolvedValue({...f.leads[5]} as any);
    await f.service.manageVisit(7,5,21,{action:'COMPLETE'},visitor);
    expect(persist).toHaveBeenCalledWith(7,5,21,{action:'COMPLETE'});
  });
  it('persists the selected Visitor and stage together in the scheduling transaction',async()=>{
    const f=fixture();
    f.prisma.$transaction=jest.fn(async callback=>callback(f.prisma));
    f.prisma.lead.findUnique=jest.fn(async()=>f.leads[0]);
    f.prisma.lead.update=jest.fn(async({data})=>Object.assign(f.leads[0],data,{stage:scheduled}));
    f.prisma.lead.findFirst=jest.fn(async()=>({...f.leads[0],visits:f.visits}));
    f.prisma.leadActivityTimeline={create:jest.fn(async()=>({id:1}))};
    f.prisma.visit.create=jest.fn(async({data})=>{const saved={...data,id:99};f.visits.push(saved);return saved;});
    const result=await f.repository.manageVisit(7,1,1,{action:'SCHEDULE',employeeId:31,date:'2026-11-01',time:'10:30 AM'});
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(f.visits[0].employeeId).toBe(31);
    expect(f.visits[0].time).toBe('10:30 AM');
    expect(f.leads[0].stageId).toBe(scheduled.id);
    expect(f.leads[0].status).toBe('VISIT_SCHEDULED');
    expect(result!.assignedVisitorId).toBe(31);
  });

  it('blocks Visitor bypasses through other stage-changing lead handlers while preserving non-Visitor access', async()=>{
    const f=fixture();const guard=new VisitorLeadActionsGuard(f.repository);
    const context=(name:string,user:any,method='POST',body:any={})=>({getHandler:()=>({name}),switchToHttp:()=>({getRequest:()=>({method,user,body})})} as any);
    for(const handler of ['convert','createProposal','recordFinalCall','recordPayment','startWork','update','remove']) {
      await expect(guard.canActivate(context(handler,visitor))).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context(handler,admin))).resolves.toBe(true);
    }
    await expect(guard.canActivate(context('updateStatus',visitor,'PATCH'))).resolves.toBe(true);
    await expect(guard.canActivate(context('manageVisit',visitor,'POST',{action:'SCHEDULE',employeeId:31}))).rejects.toThrow(ForbiddenException);
  });

});
