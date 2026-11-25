import 'reflect-metadata';
import { validate } from 'class-validator';
import { ChangeSelfPasswordDto } from './self-profile.dto';

describe('profile password validation', () => {
  it('accepts a six-character password', async () => {
    const dto = Object.assign(new ChangeSelfPasswordDto(), { currentPassword: 'old-password', newPassword: '123456' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a password shorter than six characters', async () => {
    const dto = Object.assign(new ChangeSelfPasswordDto(), { currentPassword: 'old-password', newPassword: '12345' });
    expect((await validate(dto)).some((error) => error.property === 'newPassword')).toBe(true);
  });
});
