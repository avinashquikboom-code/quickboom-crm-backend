import { ValidationPipe } from '@nestjs/common';
import { CreateMetaTemplateDto, UpdateMetaTemplateDto } from './meta-template.dto';

describe('template request contract', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
  const transform = (value: object, metatype: any) => pipe.transform(value, { type: 'body', metatype });
  it('accepts the optional boolean creation flag and samples', async () => {
    await expect(transform({ name: 'Welcome', body: 'Hello {{1}}', submitToMeta: false, sampleValues: { '1': 'Asha' } }, CreateMetaTemplateDto)).resolves.toMatchObject({ submitToMeta: false });
    await expect(transform({ name: 'Welcome', body: 'Hello', submitToMeta: 'false' }, CreateMetaTemplateDto)).rejects.toThrow();
  });
  it('rejects the creation flag on updates while accepting example values', async () => {
    await expect(transform({ body: 'Hello', submitToMeta: true }, UpdateMetaTemplateDto)).rejects.toThrow();
    await expect(transform({ body: 'Hello {{1}}', sampleValues: { '1': 'Asha' } }, UpdateMetaTemplateDto)).resolves.toMatchObject({ sampleValues: { '1': 'Asha' } });
  });
});
