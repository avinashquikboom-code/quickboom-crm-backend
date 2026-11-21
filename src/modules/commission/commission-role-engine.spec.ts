import { CommissionService } from './commission.service';
import { CommissionRulesService } from './commission-rules.service';

describe('Role engine payment and history integration',()=>{
 let db:any, service:CommissionService, rates:Record<number,number>, ledger:any[];
 beforeEach(()=>{
  rates={11:5,12:4,13:6};ledger=[];
  db={
   $queryRaw:jest.fn(),
   paymentHistory:{findFirst:jest.fn(({where})=>Promise.resolve({id:where.id,customerId:100,amount:75000,status:'SUCCESS',createdAt:new Date('2026-11-14')}))},
   customer:{findUnique:jest.fn().mockResolvedValue({id:100,leadId:10,originLead:{id:10,customerId:2},assignedEmployeeId:7,assignedEmployeeRel:{id:7,userId:8,customerId:2,designationId:11,status:'ACTIVE',designation:{commissionEnabled:true,commissionType:'PERCENTAGE',commissionRate:1}}})},
   role:{findFirst:jest.fn(({where})=>Promise.resolve({id:where.designationId,name:`Role ${where.designationId}`}))},
   commissionConfig:{findMany:jest.fn(({where})=>Promise.resolve(where.customerId===2 && rates[where.roleId]!==undefined?[{id:1,name:'Sales',slabs:[{id:2,name:'Full range',minAmount:0,maxAmount:100000,ratePercent:rates[where.roleId]}]}]:[]))},
   commission:{findUnique:jest.fn(({where})=>Promise.resolve(ledger.find(r=>r.purchaseId===where.purchaseId))),create:jest.fn(({data})=>{const row={id:ledger.length+1,...data};ledger.push(row);return Promise.resolve(row);}),update:jest.fn(({where,data})=>{Object.assign(ledger.find(r=>r.id===where.id),data);return Promise.resolve();})},
  };db.$transaction=jest.fn(fn=>fn(db));service=new CommissionService(db,new CommissionRulesService(db));
 });
 it('uses persisted payment, owning employee tenant and one existing allocation',async()=>{
  const row=await service.calculateAndAwardCommission({customerId:100,purchaseId:1,purchaseAmount:999999});
  expect(row).toMatchObject({customerId:2,employeeId:7,purchaseAmount:75000,commissionAmount:3750,commissionRate:5});
  expect(row.calculationSnapshot).toMatchObject({roleId:11,configurationId:1,slabId:2,buyerCustomerId:100,tenantId:2,employeeAmount:'3750',leaderAmount:'0',saleAmount:'75000.00'});
  expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.commission.findUnique.mock.invocationCallOrder[0]);
 });
 it('applies active role slabs when legacy designation commission is disabled',async()=>{
  db.customer.findUnique.mockResolvedValue({id:100,leadId:10,originLead:{id:10,customerId:2},assignedEmployeeId:7,assignedEmployeeRel:{id:7,userId:8,customerId:2,designationId:11,status:'ACTIVE',designation:{commissionEnabled:false,commissionType:'PERCENTAGE',commissionRate:0}}});
  const row=await service.calculateAndAwardCommission({customerId:100,purchaseId:5,purchaseAmount:75000});
  expect(row).toMatchObject({customerId:2,employeeId:7,purchaseAmount:75000,commissionAmount:3750,commissionRate:5});
  expect(row.calculationSnapshot).toMatchObject({roleId:11,configurationId:1,slabId:2});
 });
 it('retains old calculation after a rate update and awards new events at the new rate',async()=>{
  const a=await service.calculateAndAwardCommission({customerId:100,purchaseId:1,purchaseAmount:75000});const snapshot=JSON.stringify(a.calculationSnapshot);
  rates[11]=7;
  const replay=await service.calculateAndAwardCommission({customerId:100,purchaseId:1,purchaseAmount:75000});
  const b=await service.calculateAndAwardCommission({customerId:100,purchaseId:2,purchaseAmount:75000});
  expect(replay).toBe(a);expect(JSON.stringify(a.calculationSnapshot)).toBe(snapshot);expect(a.commissionAmount).toBe(3750);expect(b.commissionAmount).toBe(5250);expect(ledger).toHaveLength(2);
 });
 it('fails missing role configuration without crediting another rate',async()=>{delete rates[11];await expect(service.calculateAndAwardCommission({customerId:100,purchaseId:1,purchaseAmount:75000})).rejects.toThrow('COMMISSION_SLAB_MISSING');expect(ledger).toHaveLength(0);});
 it('rejects pending/missing payment and wrong lead tenant',async()=>{db.paymentHistory.findFirst.mockResolvedValueOnce(null);await expect(service.calculateAndAwardCommission({customerId:100,purchaseId:1,purchaseAmount:75000})).rejects.toThrow('successful');db.customer.findUnique.mockResolvedValueOnce({originLead:{customerId:3},assignedEmployeeId:7,assignedEmployeeRel:{id:7,customerId:2,designation:{commissionEnabled:true,commissionType:'PERCENTAGE',commissionRate:1}}});await expect(service.calculateAndAwardCommission({customerId:100,purchaseId:1,purchaseAmount:75000})).rejects.toThrow('tenant');expect(ledger).toHaveLength(0);});
 it('reverses the same ledger entry for the buyer without changing the snapshot or reallocating',async()=>{const row=await service.calculateAndAwardCommission({customerId:100,purchaseId:1,purchaseAmount:75000});const before=JSON.stringify(row.calculationSnapshot);await service.handleRefundOrCancellation(1,999);expect(row.status).toBe('APPROVED');await service.handleRefundOrCancellation(1,100);expect(row.status).toBe('CANCELLED');expect(JSON.stringify(row.calculationSnapshot)).toBe(before);expect(ledger).toHaveLength(1);});
});
