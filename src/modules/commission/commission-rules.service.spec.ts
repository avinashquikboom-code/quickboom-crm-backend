import { CommissionRulesService, fullSaleCommission } from './commission-rules.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('Role-specific full-payment commission rules', () => {
  let db: any, rules: CommissionRulesService;
  const date = new Date('2026-11-14T00:00:00Z');
  beforeEach(() => {
    db = { role: { findFirst: jest.fn(), findMany: jest.fn() }, commissionConfig: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({id:1}), update: jest.fn() }, commissionSlab: { create: jest.fn().mockResolvedValue({id:20}), update: jest.fn(), updateMany: jest.fn() }, $queryRaw: jest.fn() };
    db.$transaction = jest.fn(fn=>fn(db)); rules = new CommissionRulesService(db);
  });
  it.each([[40000,3,1200],[75000,5,3750],[125000,7,8750],[180000,10,18000]])('calculates full sale %s at %s%% = %s', (sale,rate,total)=>expect(fullSaleCommission(sale,rate)).toBe(total));
  it('rounds to paise with decimal arithmetic',()=>expect(fullSaleCommission('0.10','5')).toBe(0.01));
  it.each([[11,5,3750],[12,4,3000],[13,6,4500]])('isolates role %s and preserves existing single allocation',async(roleId,rate,total)=>{
    db.commissionConfig.findMany.mockImplementation(({where})=>Promise.resolve(where.customerId === 2 && where.roleId === roleId ? [{id:1,slabs:[{id:2,minAmount:0,maxAmount:100000,ratePercent:rate}]}]:[]));
    const result=await rules.select(2,roleId,75000,date);
    expect(result.total).toBe(total); expect(result.employeeAmount+result.leaderAmount).toBe(total);expect(result.leaderAmount).toBe(0);
    await expect(rules.select(3,roleId,75000,date)).rejects.toBeInstanceOf(BadRequestException);
    await expect(rules.select(2,99,75000,date)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.commissionConfig.findMany.mock.calls[0][0].where).toMatchObject({customerId:2,roleId,status:'ACTIVE'});
    expect(db.commissionConfig.findMany.mock.calls[0][0].include.slabs.where).toMatchObject({isActive:true});
  });
  it('resolves the designation-linked role from tenant relationships',async()=>{
    db.role.findFirst.mockResolvedValue({id:11,name:'Configured role'});
    expect((await rules.resolveRole({customerId:2,designationId:5,userId:8})).id).toBe(11);
    expect(db.role.findFirst).toHaveBeenCalledWith({where:{customerId:2,designationId:5,deletedAt:null}});
    expect(db.role.findMany).not.toHaveBeenCalled();
  });
  it('rejects ambiguous account roles',async()=>{db.role.findMany.mockResolvedValue([{id:1},{id:2}]);await expect(rules.resolveRole({customerId:2,userId:8})).rejects.toThrow('COMMISSION_ROLE_UNRESOLVED');});
  it('fails on missing/overlapping slabs without default fallback',async()=>{
    db.commissionConfig.findMany.mockResolvedValue([]);await expect(rules.select(2,11,75000,date)).rejects.toThrow('COMMISSION_SLAB_MISSING');
    db.commissionConfig.findMany.mockResolvedValue([{slabs:[{minAmount:0,maxAmount:null,ratePercent:3},{minAmount:0,maxAmount:null,ratePercent:4}]}]);await expect(rules.select(2,11,75000,date)).rejects.toBeInstanceOf(ConflictException);
  });
  const config=()=>({roleId:11,name:'Sales',status:'ACTIVE',calculationBasis:'FULL_PAYMENT_AMOUNT',startsAt:'2026-11-01',endsAt:null,slabs:[{name:'One',minAmount:0,maxAmount:50000,ratePercent:3,isActive:true},{name:'Two',minAmount:50000.01,maxAmount:null,ratePercent:5,isActive:true}]});
  it('validates boundaries, rates and dates',async()=>{
    for(const change of [{startsAt:'bad'},{endsAt:'2026-10-01'},{roleId:null},{calculationBasis:'PROGRESSIVE'},{slabs:[{name:'One',minAmount:10,maxAmount:5,ratePercent:3,isActive:true}]},{slabs:[{name:'One',minAmount:-1,maxAmount:5,ratePercent:3,isActive:true}]},{slabs:[{name:'One',minAmount:0,maxAmount:5,ratePercent:101,isActive:true}]}])await expect(rules.save(2,1,{...config(),...change})).rejects.toBeInstanceOf(BadRequestException);
    const overlap=config();overlap.slabs[1].minAmount=50000;await expect(rules.save(2,1,overlap)).rejects.toBeInstanceOf(ConflictException);
    const gap=config();gap.slabs[1].minAmount=50001;await expect(rules.save(2,1,gap)).rejects.toThrow('gap');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('checks tenant ownership and serialized active-period conflicts',async()=>{
    db.role.findFirst.mockResolvedValue(null);await expect(rules.save(2,1,config())).rejects.toThrow('tenant');
    db.role.findFirst.mockResolvedValue({id:11});db.commissionConfig.count.mockResolvedValue(1);await expect(rules.save(2,1,config())).rejects.toBeInstanceOf(ConflictException);
    expect(db.$queryRaw).toHaveBeenCalled();expect(db.commissionConfig.create).not.toHaveBeenCalled();
  });
  it('keeps a prior configuration snapshot and deactivates removed slabs without touching credits',async()=>{
    db.role.findFirst.mockResolvedValue({id:11});db.commissionConfig.findFirst.mockResolvedValue({id:1,name:'Before',roleId:11,history:[],slabs:[{id:9,name:'Old',ratePercent:3}]});db.commissionConfig.update.mockResolvedValue({id:1});
    await rules.save(2,7,config(),1);
    expect(db.commissionConfig.update.mock.calls[0][0].data.history[0]).toMatchObject({name:'Before',changedById:7,slabs:[{id:9,name:'Old',ratePercent:3}]});
    expect(db.commissionSlab.updateMany).toHaveBeenCalledWith({where:{configurationId:1,id:{notIn:[20,20]}},data:{isActive:false}});
  });
});
