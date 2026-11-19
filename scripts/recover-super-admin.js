/**
 * Secure Super Admin Account and Password Recovery Utility
 *
 * Usage:
 *   node scripts/recover-super-admin.js [newPassword] [targetEmailOrId]
 *
 * Example:
 *   node scripts/recover-super-admin.js "MyNewSecurePassword123!" "admin@quikboom.com"
 */

const { PrismaClient, RoleType } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

function getEmailLookupVariants(email) {
  const raw = (email || '').trim().toLowerCase();
  if (!raw) return [];
  const variants = new Set([raw]);
  if (raw.endsWith('@quikboom.com')) {
    variants.add(raw.replace('@quikboom.com', '@quickboom.com'));
  } else if (raw.endsWith('@quickboom.com')) {
    variants.add(raw.replace('@quickboom.com', '@quikboom.com'));
  }
  return Array.from(variants);
}

async function main() {
  const args = process.argv.slice(2);
  const newPassword = args[0] || '123456';
  const targetIdentifier = args[1] || 'admin@quikboom.com';

  console.log('====================================================');
  console.log('   QB Suite Super Admin Account Recovery Utility    ');
  console.log('====================================================');

  if (newPassword.length < 6) {
    console.error('❌ Error: Password must be at least 6 characters long.');
    process.exit(1);
  }

  const isNumericId = /^\d+$/.test(targetIdentifier);
  const targetId = isNumericId ? parseInt(targetIdentifier, 10) : 1;
  const emailVariants = isNumericId ? [] : getEmailLookupVariants(targetIdentifier);

  // 1. Locate existing Administrator user without altering other users
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { id: targetId },
        ...emailVariants.map(e => ({ email: { equals: e, mode: 'insensitive' } }))
      ]
    },
    include: {
      userRoles: {
        include: { role: true }
      }
    }
  });

  if (!user) {
    console.error(`❌ Error: No existing administrator found matching ID ${targetId} or email variant.`);
    process.exit(1);
  }

  console.log(`[+] Found Administrator Account:`);
  console.log(`    - User ID: ${user.id}`);
  console.log(`    - Current Email: ${user.email}`);
  console.log(`    - Name: ${user.firstName} ${user.lastName}`);
  console.log(`    - Tenant ID: ${user.customerId ?? 'None (Platform-wide)'}`);

  // 2. Hash password with bcrypt salt rounds = 10
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // 3. Ensure standard SUPER_ADMIN role exists
  let superAdminRole = await prisma.role.findFirst({
    where: {
      OR: [
        { type: RoleType.SUPER_ADMIN },
        { name: 'SUPER_ADMIN' },
        { name: 'Super Administrator' }
      ]
    }
  });

  if (!superAdminRole) {
    superAdminRole = await prisma.role.create({
      data: {
        name: 'Super Administrator',
        type: RoleType.SUPER_ADMIN,
        description: 'Platform Super Administrator with full system control'
      }
    });
    console.log(`[+] Created missing SUPER_ADMIN role (ID: ${superAdminRole.id})`);
  }

  // 4. Update Administrator account (preserve ID, tenant, and restore active status)
  const canonicalEmail = 'admin@quikboom.com';
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      email: canonicalEmail,
      passwordHash: hashedPassword,
      isActive: true,
      isVerified: true,
      deletedAt: null
    }
  });

  // 5. Ensure Super Admin role is linked in user_roles
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: updatedUser.id,
        roleId: superAdminRole.id
      }
    },
    create: {
      userId: updatedUser.id,
      roleId: superAdminRole.id
    },
    update: {}
  });

  // 6. Revoke stale sessions and refresh tokens for security
  const revokedTokens = await prisma.refreshToken.updateMany({
    where: { userId: updatedUser.id, isRevoked: false },
    data: { isRevoked: true }
  });

  const deletedSessions = await prisma.session.deleteMany({
    where: { userId: updatedUser.id }
  });

  // 7. Write security audit log
  await prisma.auditLog.create({
    data: {
      userId: updatedUser.id,
      userName: `${updatedUser.firstName} ${updatedUser.lastName}`.trim(),
      userRole: 'SUPER_ADMIN',
      source: 'ADMIN_RECOVERY',
      action: 'PASSWORD_RESET',
      module: 'Security',
      description: 'Super Admin password recovered and sessions revoked securely via recovery utility.',
      status: 'SUCCESS',
      details: {
        targetUserId: updatedUser.id,
        targetEmail: updatedUser.email,
        revokedTokensCount: revokedTokens.count,
        deletedSessionsCount: deletedSessions.count,
        timestamp: new Date().toISOString()
      }
    }
  });

  console.log(`\n✅ Administrator Account Successfully Verified & Restored!`);
  console.log(`    - User ID: ${updatedUser.id}`);
  console.log(`    - Primary Login Email: ${updatedUser.email}`);
  console.log(`    - Domain Alias Supported: admin@quickboom.com`);
  console.log(`    - Super Admin Role: ${superAdminRole.name} (${superAdminRole.type})`);
  console.log(`    - Account Status: Active (isVerified: true, deletedAt: null)`);
  console.log(`    - Stale Refresh Tokens Revoked: ${revokedTokens.count}`);
  console.log(`    - Active Sessions Terminated: ${deletedSessions.count}`);
  console.log(`    - Audit Log: Recorded successfully.`);
  console.log('====================================================\n');
}

main()
  .catch(err => {
    console.error('❌ Recovery failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
