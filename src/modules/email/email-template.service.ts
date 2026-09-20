import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { PreviewEmailTemplateDto } from './dto/preview-email-template.dto';

export interface SystemTemplateDefinition {
  key: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  description: string;
  supportedVariables: string[];
}

export const PREDEFINED_SYSTEM_TEMPLATES: SystemTemplateDefinition[] = [
  {
    key: 'EMAIL_OTP',
    name: 'Email OTP Verification',
    category: 'AUTH',
    subject: 'Your OTP for {{companyName}}',
    description: 'Sent when a user requests an email verification code for login or password reset',
    supportedVariables: ['companyName', 'userName', 'otp'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <img src="cid:quikboom-logo" alt="QUIKBOOM" style="max-height: 44px; width: auto; display: inline-block;" />
  </div>
  <h2 style="color: #0f172a; margin-top: 0; margin-bottom: 16px; font-size: 20px;">Verification Code</h2>
  <p style="color: #475569; font-size: 15px; margin-bottom: 12px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px; margin-bottom: 20px;">Your verification OTP is:</p>
  <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
    <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #16a34a; font-family: monospace;">{{otp}}</span>
  </div>
  <p style="color: #64748b; font-size: 14px; margin-top: 16px;">This OTP will expire in <strong>5 minutes</strong>.</p>
  <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">If you did not request this verification code, please ignore this email or contact support immediately.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">Regards,<br /><strong style="color: #475569;">{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'PASSWORD_RESET',
    name: 'Password Reset Notification',
    category: 'AUTH',
    subject: 'Reset your {{companyName}} password',
    description: 'Sent when an employee or administrator requests a password reset link or OTP',
    supportedVariables: ['companyName', 'userName', 'resetLink', 'otp'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <img src="cid:quikboom-logo" alt="QUIKBOOM" style="max-height: 44px; width: auto; display: inline-block;" />
  </div>
  <h2 style="color: #0f172a; margin-top: 0;">Password Reset Request</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">We received a request to reset your password for {{companyName}}.</p>
  <div style="margin: 24px 0;">
    <a href="{{resetLink}}" style="background-color: #16a34a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
  </div>
  <p style="color: #64748b; font-size: 14px;">Alternatively, enter this OTP: <strong>{{otp}}</strong></p>
  <p style="color: #94a3b8; font-size: 13px; margin-top: 24px;">This request will expire in 15 minutes. If you did not make this request, you can safely ignore this email.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'EMPLOYEE_WELCOME',
    name: 'New Employee Welcome',
    category: 'HR',
    subject: 'Welcome to {{companyName}}, {{userName}}!',
    description: 'Sent to newly created employees with their onboarding login details',
    supportedVariables: ['companyName', 'userName', 'email', 'temporaryPassword', 'loginUrl', 'designation'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <img src="cid:quikboom-logo" alt="QUIKBOOM" style="max-height: 44px; width: auto; display: inline-block;" />
  </div>
  <h2 style="color: #0f172a; margin-top: 0;">Welcome to {{companyName}}!</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">We are excited to welcome you to the team as <strong>{{designation}}</strong>.</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 20px 0;">
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Login Email:</strong> {{email}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Temporary Password:</strong> {{temporaryPassword}}</p>
  </div>
  <p style="margin: 24px 0;">
    <a href="{{loginUrl}}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Access Employee Portal</a>
  </p>
  <p style="color: #64748b; font-size: 13px;">Please change your password upon your first login.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Warm regards,<br /><strong>{{companyName}} HR Team</strong></p>
</div>`,
  },
  {
    key: 'LEAVE_APPROVED',
    name: 'Leave Application Approved',
    category: 'LEAVE',
    subject: 'Leave Approved: {{leaveType}} ({{startDate}} to {{endDate}})',
    description: 'Sent to employee when their leave application is approved by manager or HR',
    supportedVariables: ['companyName', 'userName', 'leaveType', 'startDate', 'endDate', 'approverName', 'remarks'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <img src="cid:quikboom-logo" alt="QUIKBOOM" style="max-height: 44px; width: auto; display: inline-block;" />
  </div>
  <h2 style="color: #16a34a; margin-top: 0;">Leave Approved</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">Your application for <strong>{{leaveType}}</strong> from <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong> has been <strong style="color: #16a34a;">APPROVED</strong> by {{approverName}}.</p>
  <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; margin: 20px 0;">
    <p style="margin: 0; font-size: 14px; color: #166534;"><strong>Manager Remarks:</strong> {{remarks}}</p>
  </div>
  <p style="color: #64748b; font-size: 13px;">Your leave balance has been updated in the HRM portal.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'LEAVE_REJECTED',
    name: 'Leave Application Rejected',
    category: 'LEAVE',
    subject: 'Leave Update: {{leaveType}} ({{startDate}} to {{endDate}})',
    description: 'Sent to employee when their leave application cannot be approved',
    supportedVariables: ['companyName', 'userName', 'leaveType', 'startDate', 'endDate', 'approverName', 'rejectionReason'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <img src="cid:quikboom-logo" alt="QUIKBOOM" style="max-height: 44px; width: auto; display: inline-block;" />
  </div>
  <h2 style="color: #dc2626; margin-top: 0;">Leave Application Update</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{userName}},</p>
  <p style="color: #475569; font-size: 15px;">Your application for <strong>{{leaveType}}</strong> from <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong> was reviewed by {{approverName}} and could not be approved at this time.</p>
  <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin: 20px 0;">
    <p style="margin: 0; font-size: 14px; color: #991b1b;"><strong>Reason:</strong> {{rejectionReason}}</p>
  </div>
  <p style="color: #64748b; font-size: 13px;">If you have any questions or need to discuss further, please contact your reporting manager.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'LEAD_DETAILS',
    name: 'Lead Assignment & Details',
    category: 'CRM',
    subject: 'New Lead Assigned: {{leadTitle}}',
    description: 'Sent to sales representative or contact when a lead is created or shared',
    supportedVariables: ['companyName', 'recipientName', 'leadTitle', 'leadContact', 'leadPhone', 'leadCity', 'leadValue', 'leadNotes'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <img src="cid:quikboom-logo" alt="QUIKBOOM" style="max-height: 44px; width: auto; display: inline-block;" />
  </div>
  <h2 style="color: #0f172a; margin-top: 0;">Lead Details</h2>
  <p style="color: #475569; font-size: 15px;">Hello {{recipientName}},</p>
  <p style="color: #475569; font-size: 15px;">Here are the details for lead <strong>{{leadTitle}}</strong>:</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin: 16px 0;">
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Contact:</strong> {{leadContact}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Phone:</strong> {{leadPhone}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>City / Location:</strong> {{leadCity}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Potential Value:</strong> &#x20B9;{{leadValue}}</p>
    <p style="margin: 4px 0; font-size: 14px; color: #334155;"><strong>Notes:</strong> {{leadNotes}}</p>
  </div>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Sent via <strong>{{companyName}} CRM</strong></p>
</div>`,
  },
  {
    key: 'CUSTOMER_WELCOME',
    name: 'Customer Welcome & Onboarding',
    category: 'CRM',
    subject: 'Welcome to {{companyName}}!',
    description: 'Sent to newly converted customers or registered enterprise clients',
    supportedVariables: ['companyName', 'customerName', 'contactEmail', 'supportPhone'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <img src="cid:quikboom-logo" alt="QUIKBOOM" style="max-height: 44px; width: auto; display: inline-block;" />
  </div>
  <h2 style="color: #0f172a; margin-top: 0;">Welcome to {{companyName}}!</h2>
  <p style="color: #475569; font-size: 15px;">Dear {{customerName}},</p>
  <p style="color: #475569; font-size: 15px;">Thank you for partnering with {{companyName}}. We are thrilled to have you onboard.</p>
  <p style="color: #475569; font-size: 15px;">Our team is dedicated to supporting your growth. If you ever have questions or require assistance, reach out at <a href="mailto:{{contactEmail}}">{{contactEmail}}</a> or call {{supportPhone}}.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Warm regards,<br /><strong>{{companyName}}</strong></p>
</div>`,
  },
  {
    key: 'QUIKBOOM_NEW_LEAD',
    name: 'New Lead – QUIKBOOM',
    category: 'CRM',
    subject: 'Thank You for Connecting with QUIKBOOM',
    description: 'Sent automatically when a new inquiry or lead connects with QUIKBOOM',
    supportedVariables: ['leadTitle', 'userName', 'email'],
    body: `Dear {{leadTitle}},

Thank you for your interest in QUIKBOOM Digital Marketing Agency.

Our team has received your inquiry and will be connecting with you shortly to understand your business requirements.

We look forward to speaking with you and exploring how we can help your business grow.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
  },
  {
    key: 'QUIKBOOM_CONTACTED',
    name: 'Customer Contacted – QUIKBOOM',
    category: 'CRM',
    subject: 'Great Speaking With You – QUIKBOOM',
    description: 'Sent after initial telecaller contact with the prospective lead',
    supportedVariables: ['leadTitle', 'userName'],
    body: `Dear {{leadTitle}},

Thank you for taking the time to speak with our team.

We appreciate the opportunity to understand your business and digital marketing requirements.

We will be happy to assist you with the right solutions for your business.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'QUIKBOOM_QUALIFIED',
    name: 'Lead Qualified – QUIKBOOM',
    category: 'CRM',
    subject: 'Your Requirements Have Been Qualified – QUIKBOOM',
    description: 'Sent automatically when a prospective lead is qualified by the CRM team',
    supportedVariables: ['leadTitle', 'leadName', 'userName', 'email', 'companyName', 'assignedUser', 'assignedEmployeeName', 'assignedEmployeeEmail'],
    body: `Dear {{leadTitle}},

We are pleased to inform you that your requirements with QUIKBOOM Digital Marketing Agency have been qualified!

Our team is now preparing tailored solutions to help your business achieve maximum growth. We will be in touch with a customized proposal shortly.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
  },
  {
    key: 'QUIKBOOM_DETAILS_SENT',
    name: 'Company Details Sent – QUIKBOOM',
    category: 'CRM',
    subject: 'QUIKBOOM – Company Details & Services',
    description: 'Sent along with marketing agency overview and company credentials',
    supportedVariables: ['leadTitle', 'userName', 'email'],
    body: `Dear {{leadTitle}},

As discussed during our call, we are sharing the details of QUIKBOOM Digital Marketing Agency for your reference.

You can explore our company, services and work through our website.

Visit QUIKBOOM Website

We look forward to discussing your requirements further.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
  },
  {
    key: 'QUIKBOOM_FOLLOW_UP',
    name: 'Customer Follow-up – QUIKBOOM',
    category: 'CRM',
    subject: 'Following Up on Our Discussion – QUIKBOOM',
    description: 'Sent during regular follow-up touchpoints',
    supportedVariables: ['leadTitle', 'userName'],
    body: `Dear {{leadTitle}},

We wanted to follow up regarding our recent conversation about your digital marketing requirements.

Please let us know if you have any questions or if you would like to discuss the next steps.

Our team will be happy to assist you.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'QUIKBOOM_VISIT_SCHEDULED',
    name: 'Visit Scheduled – QUIKBOOM',
    category: 'CRM',
    subject: 'Your Meeting with QUIKBOOM is Scheduled',
    description: 'Sent upon scheduling an in-person or virtual field meeting',
    supportedVariables: ['leadTitle', 'startDate', 'startTime', 'userName'],
    body: `Dear {{leadTitle}},

This is to confirm that your visit/meeting with QUIKBOOM Digital Marketing Agency has been scheduled.

We look forward to meeting you and discussing your business requirements in detail.

Meeting Details:

Date: {{startDate}}

Time: {{startTime}}

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'QUIKBOOM_VISIT_DONE',
    name: 'Visit Completed – QUIKBOOM',
    category: 'CRM',
    subject: 'Thank You for Visiting QUIKBOOM',
    description: 'Sent following the conclusion of a client visit or meeting',
    supportedVariables: ['leadTitle', 'userName'],
    body: `Dear {{leadTitle}},

Thank you for visiting QUIKBOOM Digital Marketing Agency.

It was a pleasure meeting with you and discussing your business requirements.

We appreciate your time and look forward to taking our conversation ahead.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'QUIKBOOM_PROPOSAL_SENT',
    name: 'Proposal Sent – QUIKBOOM',
    category: 'CRM',
    subject: 'Your Digital Marketing Proposal from QUIKBOOM',
    description: 'Sent when the formal digital marketing quotation/proposal is dispatched',
    supportedVariables: ['leadTitle', 'userName'],
    body: `Dear {{leadTitle}},

As discussed, we have shared the proposal for your business requirements.

Please review the proposal and feel free to contact us if you have any questions or require any clarification.

We look forward to working with you.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'QUIKBOOM_NEGOTIATION',
    name: 'Proposal Discussion – QUIKBOOM',
    category: 'CRM',
    subject: "Let's Discuss Your Proposal – QUIKBOOM",
    description: 'Sent during commercial discussions and scope adjustments',
    supportedVariables: ['leadTitle', 'userName'],
    body: `Dear {{leadTitle}},

Thank you for reviewing our proposal.

We would be happy to discuss the proposal, requirements and available options with you.

Please feel free to share your feedback so that we can take the discussion forward.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'QUIKBOOM_FINAL_CALL',
    name: 'Final Discussion – QUIKBOOM',
    category: 'CRM',
    subject: 'Final Discussion Regarding Your Digital Marketing Requirements',
    description: 'Sent for concluding conversations before deal sign-off',
    supportedVariables: ['leadTitle', 'userName'],
    body: `Dear {{leadTitle}},

We are reaching out for a final discussion regarding the digital marketing solutions discussed with you.

Please let us know if you would like to proceed or if there are any remaining questions we can help you with.

We look forward to hearing from you.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'QUIKBOOM_WON',
    name: 'Customer Onboarding – QUIKBOOM',
    category: 'CRM',
    subject: "Welcome to QUIKBOOM – Let's Grow Together! 🎉",
    description: 'Sent when the lead deal is successfully closed/won',
    supportedVariables: ['leadTitle', 'userName', 'email'],
    body: `Dear {{leadTitle}},

Welcome to QUIKBOOM Digital Marketing Agency! 🎉

Thank you for choosing QUIKBOOM as your digital marketing partner.

We are excited to work with you and help your business achieve its digital marketing goals.

Our team will connect with you regarding the next steps and onboarding process.

Welcome to the QUIKBOOM family!

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency

{{email}}`,
  },
  {
    key: 'QUIKBOOM_LOST',
    name: 'Lead Closed – QUIKBOOM',
    category: 'CRM',
    subject: 'Thank You for Considering QUIKBOOM',
    description: 'Sent gracefully when a lead is marked as closed/lost',
    supportedVariables: ['leadTitle', 'userName'],
    body: `Dear {{leadTitle}},

Thank you for taking the time to speak with QUIKBOOM Digital Marketing Agency and considering our services.

We completely understand that the timing may not be right at this moment.

If your requirements change in the future, we would be happy to connect with you again.

We wish you and your business continued success.

Regards,

{{userName}}

QUIKBOOM Digital Marketing Agency`,
  },
  {
    key: 'PLAN_PURCHASE_SUCCESS',
    name: 'Plan Purchase & Activation',
    category: 'SUBSCRIPTION',
    subject: 'Plan Activated: {{planName}} – {{companyName}}',
    description: 'Sent automatically when a customer purchases or activates a subscription plan',
    supportedVariables: ['customerName', 'planName', 'billingCycle', 'startDate', 'expiryDate', 'price', 'transactionId', 'companyName'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <h2 style="color: #0f172a; margin: 0;">{{companyName}}</h2>
    <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">Subscription Confirmation</p>
  </div>
  <p style="color: #334155; font-size: 15px;">Dear {{customerName}},</p>
  <p style="color: #334155; font-size: 15px;">Your subscription to the <strong>{{planName}}</strong> plan has been activated successfully! 🎉</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Plan:</strong> {{planName}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Billing Cycle:</strong> {{billingCycle}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Start Date:</strong> {{startDate}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Valid Until:</strong> {{expiryDate}}</p>
  </div>
  <p style="color: #475569; font-size: 14px;">Thank you for choosing {{companyName}}. We look forward to supporting your business growth.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Sent via <strong>{{companyName}}</strong> &bull; CRM</p>
</div>`,
  },
  {
    key: 'PAYMENT_SUCCESS',
    name: 'Payment Receipt Confirmation',
    category: 'BILLING',
    subject: 'Payment Confirmation: ₹{{amount}} for {{planName}} – {{companyName}}',
    description: 'Sent automatically when payment is successfully verified (online or offline)',
    supportedVariables: ['customerName', 'amount', 'planName', 'paymentMethod', 'transactionId', 'orderId', 'paymentDate', 'companyName'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <h2 style="color: #0f172a; margin: 0;">{{companyName}}</h2>
    <p style="color: #16a34a; font-size: 14px; font-weight: bold; margin: 4px 0 0;">Payment Successful ✅</p>
  </div>
  <p style="color: #334155; font-size: 15px;">Dear {{customerName}},</p>
  <p style="color: #334155; font-size: 15px;">We have received your payment. Below are your payment receipt details:</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Amount Paid:</strong> ₹{{amount}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Plan / Service:</strong> {{planName}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Payment Method:</strong> {{paymentMethod}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Transaction ID:</strong> {{transactionId}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Date:</strong> {{paymentDate}}</p>
  </div>
  <p style="color: #475569; font-size: 14px;">Your official tax invoice is attached with this email for your accounting records.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Sent via <strong>{{companyName}}</strong> &bull; Billing</p>
</div>`,
  },
  {
    key: 'INVOICE_GENERATED',
    name: 'Tax Invoice',
    category: 'BILLING',
    subject: 'Tax Invoice #{{invoiceNo}} from {{companyName}}',
    description: 'Sent with invoice PDF attached after successful payment settlement',
    supportedVariables: ['customerName', 'invoiceNo', 'amount', 'dueDate', 'issueDate', 'companyName'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <h2 style="color: #0f172a; margin: 0;">{{companyName}}</h2>
    <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">Official Tax Invoice</p>
  </div>
  <p style="color: #334155; font-size: 15px;">Dear {{customerName}},</p>
  <p style="color: #334155; font-size: 15px;">Please find attached your official tax invoice <strong>#{{invoiceNo}}</strong> for the amount of <strong>₹{{amount}}</strong>.</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Invoice Number:</strong> {{invoiceNo}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Invoice Date:</strong> {{issueDate}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Total Settled:</strong> ₹{{amount}}</p>
  </div>
  <p style="color: #475569; font-size: 14px;">The PDF version of your invoice is attached to this email.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Sent via <strong>{{companyName}}</strong> &bull; Accounts</p>
</div>`,
  },
  {
    key: 'CALENDAR_SCHEDULED',
    name: 'Appointment / Meeting Scheduled',
    category: 'CALENDAR',
    subject: 'Meeting Scheduled: {{eventTitle}} with {{companyName}}',
    description: 'Sent when an appointment or calendar event is successfully scheduled with PDF attachment',
    supportedVariables: ['customerName', 'eventTitle', 'date', 'time', 'location', 'assignedEmployee', 'companyName', 'notes'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <h2 style="color: #0f172a; margin: 0;">{{companyName}}</h2>
    <p style="color: #0284c7; font-size: 14px; font-weight: bold; margin: 4px 0 0;">Meeting Confirmation 📅</p>
  </div>
  <p style="color: #334155; font-size: 15px;">Dear {{customerName}},</p>
  <p style="color: #334155; font-size: 15px;">Your meeting has been scheduled. Below are the appointment details:</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Meeting / Purpose:</strong> {{eventTitle}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Date:</strong> {{date}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Time:</strong> {{time}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Location / Link:</strong> {{location}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #334155;"><strong>Assigned Representative:</strong> {{assignedEmployee}}</p>
  </div>
  <p style="color: #475569; font-size: 14px;">An official Appointment Confirmation PDF document is attached with this email.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Sent via <strong>{{companyName}}</strong> &bull; Calendar</p>
</div>`,
  },
  {
    key: 'PLAN_EXPIRY_REMINDER',
    name: 'Plan Expiry Reminder (3 Days)',
    category: 'SUBSCRIPTION',
    subject: 'Action Required: Your {{planName}} Plan Expires in 3 Days – {{companyName}}',
    description: 'Sent automatically exactly 3 days before a subscription plan expires',
    supportedVariables: ['customerName', 'planName', 'expiryDate', 'daysRemaining', 'companyName'],
    body: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e2e8f0;">
    <h2 style="color: #0f172a; margin: 0;">{{companyName}}</h2>
    <p style="color: #ea580c; font-size: 14px; font-weight: bold; margin: 4px 0 0;">Subscription Expiry Notice ⚠️</p>
  </div>
  <p style="color: #334155; font-size: 15px;">Dear {{customerName}},</p>
  <p style="color: #334155; font-size: 15px;">This is a friendly reminder that your <strong>{{planName}}</strong> subscription will expire in <strong>3 days</strong> on <strong>{{expiryDate}}</strong>.</p>
  <div style="background-color: #fff7ed; border: 1px solid #ffedd5; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="margin: 6px 0; font-size: 14px; color: #9a3412;"><strong>Plan:</strong> {{planName}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #9a3412;"><strong>Expiry Date:</strong> {{expiryDate}}</p>
    <p style="margin: 6px 0; font-size: 14px; color: #9a3412;"><strong>Days Remaining:</strong> 3 days</p>
  </div>
  <p style="color: #475569; font-size: 14px;">To avoid any disruption to your business operations and features, please renew your subscription before the expiration date.</p>
  <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #94a3b8; font-size: 12px;">Sent via <strong>{{companyName}}</strong> &bull; Subscriptions</p>
</div>`,
  },
];

export const TELECALLER_STATUS_TO_TEMPLATE_KEY: Record<string, string> = {
  NEW: 'QUIKBOOM_NEW_LEAD',
  NEW_LEAD: 'QUIKBOOM_NEW_LEAD',
  CONTACTED: 'QUIKBOOM_CONTACTED',
  CALL_BACK: 'QUIKBOOM_CONTACTED',
  QUALIFIED: 'QUIKBOOM_QUALIFIED',
  DETAILS_SENT: 'QUIKBOOM_DETAILS_SENT',
  DETAILS_SEND: 'QUIKBOOM_DETAILS_SENT',
  COMPANY_DETAILS_SENT: 'QUIKBOOM_DETAILS_SENT',
  FOLLOW_UP: 'QUIKBOOM_FOLLOW_UP',
  FOLLOWUP: 'QUIKBOOM_FOLLOW_UP',
  CUSTOMER_FOLLOW_UP: 'QUIKBOOM_FOLLOW_UP',
  VISIT_SCHEDULED: 'QUIKBOOM_VISIT_SCHEDULED',
  VISIT: 'QUIKBOOM_VISIT_SCHEDULED',
  VISIT_DONE: 'QUIKBOOM_VISIT_DONE',
  VISIT_COMPLETED: 'QUIKBOOM_VISIT_DONE',
  PROPOSAL_SENT: 'QUIKBOOM_PROPOSAL_SENT',
  PROPOSAL: 'QUIKBOOM_PROPOSAL_SENT',
  NEGOTIATION: 'QUIKBOOM_NEGOTIATION',
  FINAL_CALL: 'QUIKBOOM_FINAL_CALL',
  FINAL_DISCUSSION: 'QUIKBOOM_FINAL_CALL',
  WON: 'QUIKBOOM_WON',
  CLOSED_WON: 'QUIKBOOM_WON',
  CONVERTED: 'QUIKBOOM_WON',
  DEAL_WON: 'QUIKBOOM_WON',
  WORK_STARTED: 'QUIKBOOM_WON',
  PAYMENT: 'QUIKBOOM_PROPOSAL_SENT',
  LOST: 'QUIKBOOM_LOST',
  CLOSED_LOST: 'QUIKBOOM_LOST',
  CANCELLED: 'QUIKBOOM_LOST',
  DEAL_LOST: 'QUIKBOOM_LOST',
};

export interface RenderTemplateOptions {
  requiredVariables?: string[];
  safeFallbacks?: Record<string, string>;
  strict?: boolean;
}

export interface RenderedTemplateResult {
  subject: string;
  body: string;
  variablesUsed: Record<string, any>;
  missingVariables: string[];
}

export function wrapInQuikboomEmailHtml(content: string, options?: { previewText?: string; companyName?: string; logoSrc?: string }): string {
  if (!content) return '';
  if (content.includes('<html') || content.includes('<!DOCTYPE') || content.includes('<body')) {
    return content;
  }

  // Use CID for actual email sends; fallback to /logo.png for web previews
  const logoSrc = options?.logoSrc ?? 'cid:quikboom-logo';

  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.includes('<p') || trimmed.includes('<div') || trimmed.includes('<table')) return trimmed;
      if (trimmed === 'Visit QUIKBOOM Website' || trimmed.includes('Visit QUIKBOOM Website')) {
        return `<p style="margin: 20px 0; text-align: center;"><a href="https://quikboom.com" style="display: inline-block; padding: 12px 28px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">Visit QUIKBOOM Website &rarr;</a></p>`;
      }
      return `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; -webkit-font-smoothing: antialiased; }
    .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .email-header { background: linear-gradient(135deg, #0f172a, #1e293b); padding: 24px 32px; text-align: center; color: #ffffff; }
    .email-header img { max-height: 48px; width: auto; display: inline-block; margin-bottom: 10px; }
    .email-header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
    .email-header p { margin: 0; font-size: 13px; color: #94a3b8; }
    .email-body { padding: 32px; font-size: 15px; line-height: 1.6; color: #334155; }
    .email-footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <img src="${logoSrc}" alt="QUIKBOOM" />
      <h1>QUIKBOOM</h1>
      <p>Digital Marketing Agency</p>
    </div>
    <div class="email-body">
      ${paragraphs}
    </div>
    <div class="email-footer">
      Sent via <strong>QUIKBOOM Digital Marketing Agency</strong> &bull; CRM
    </div>
  </div>
</body>
</html>`.trim();
}

export function renderEmailTemplate(
  template: { subject: string; body: string },
  variables: Record<string, any> = {},
  options?: RenderTemplateOptions,
): RenderedTemplateResult {
  const missingVars = new Set<string>();

  const defaultFallbacks: Record<string, string> = {
    leadTitle: 'Valued Client',
    customerName: 'Valued Client',
    userName: 'QUIKBOOM Team',
    email: 'support@quikboom.com',
    companyName: 'QUIKBOOM Digital Marketing Agency',
    ...(options?.safeFallbacks || {}),
  };

  const replacer = (text: string): string => {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
      const val = variables[varName];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return String(val);
      }
      missingVars.add(varName);

      if (options?.strict && options.requiredVariables?.includes(varName)) {
        throw new BadRequestException(`Required template variable "${varName}" is missing`);
      }

      if (varName in defaultFallbacks) {
        return defaultFallbacks[varName];
      }

      // Never leave raw placeholder
      return '';
    });
  };

  const renderedSubject = replacer(template.subject);
  const renderedBody = replacer(template.body);

  return {
    subject: renderedSubject,
    body: renderedBody,
    variablesUsed: variables,
    missingVariables: Array.from(missingVars),
  };
}

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  private formatTemplate(t: any) {
    if (!t) return null;
    return {
      ...t,
      identifierKey: t.key,
      templateName: t.name,
    };
  }

  /**
   * Safely interpolates {{variables}} inside a string template.
   * Does NOT evaluate expressions or execute code.
   */
  interpolate(templateStr: string, variables: Record<string, any> = {}): string {
    if (!templateStr || typeof templateStr !== 'string') return '';
    return templateStr.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
      if (varName in variables && variables[varName] !== undefined && variables[varName] !== null) {
        return String(variables[varName]);
      }
      return match;
    });
  }

  renderEmailTemplate(
    template: { subject: string; body: string },
    variables: Record<string, any> = {},
    options?: RenderTemplateOptions,
  ): RenderedTemplateResult {
    return renderEmailTemplate(template, variables, options);
  }

  /**
   * Auto-seeds standard templates for a customer or global workspace if they do not exist.
   */
  async ensureDefaultTemplates(customerId?: number | null) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    for (const item of PREDEFINED_SYSTEM_TEMPLATES) {
      const existing = await this.prisma.emailTemplate.findFirst({
        where: {
          key: item.key,
          customerId: numCustomerId,
          deletedAt: null,
        },
      });

      if (!existing) {
        await this.prisma.emailTemplate.create({
          data: {
            customerId: numCustomerId,
            key: item.key,
            name: item.name,
            subject: item.subject,
            body: item.body,
            category: item.category,
            description: item.description,
            supportedVariables: item.supportedVariables,
            isSystem: true,
            isActive: true,
          },
        }).catch((err) => {
          this.logger.warn(`Failed to seed template ${item.key}: ${err?.message}`);
        });
      }
    }
  }

  /**
   * Lists templates with optional search and category filters.
   */
  async findAll(customerId?: number | null, query?: { category?: string; isActive?: string | boolean; search?: string }) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;
    await this.ensureDefaultTemplates(numCustomerId);

    const where: any = {
      deletedAt: null,
      OR: [
        { customerId: numCustomerId },
        { customerId: null },
      ],
    };

    if (query?.category && query.category !== 'ALL') {
      where.category = query.category.toUpperCase();
    }

    if (query?.isActive !== undefined && query.isActive !== '' && query.isActive !== 'ALL') {
      where.isActive = String(query.isActive) === 'true';
    }

    if (query?.search) {
      const s = query.search.trim();
      where.AND = [
        {
          OR: [
            { name: { contains: s, mode: 'insensitive' } },
            { key: { contains: s, mode: 'insensitive' } },
            { subject: { contains: s, mode: 'insensitive' } },
            { description: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const templates = await this.prisma.emailTemplate.findMany({
      where,
      orderBy: [
        { isSystem: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    // Deduplicate: customer-specific overrides take precedence over global templates
    const map = new Map<string, any>();
    for (const t of templates) {
      if (!map.has(t.key) || (t.customerId === numCustomerId && map.get(t.key)?.customerId === null)) {
        map.set(t.key, this.formatTemplate(t));
      }
    }

    return Array.from(map.values());
  }

  /**
   * Retrieves single template by ID.
   */
  async findOne(id: number, customerId?: number | null) {
    const numId = Number(id);
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    const template = await this.prisma.emailTemplate.findFirst({
      where: {
        id: numId,
        deletedAt: null,
        OR: [
          { customerId: numCustomerId },
          { customerId: null },
        ],
      },
    });

    if (!template) {
      throw new NotFoundException(`Email template with ID ${id} not found`);
    }

    return this.formatTemplate(template);
  }

  /**
   * Resolves template by key for email delivery.
   * Checks customer-specific template first; falls back to global/system default;
   * falls back to hardcoded code default if not found in database.
   */
  async findByKey(key: string, customerId?: number | null) {
    const upperKey = (key || '').trim().toUpperCase();
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    // 1. Customer-specific active template
    if (numCustomerId) {
      const custom = await this.prisma.emailTemplate.findFirst({
        where: {
          key: upperKey,
          customerId: numCustomerId,
          isActive: true,
          deletedAt: null,
        },
      });
      if (custom) return this.formatTemplate(custom);
    }

    // 2. Global active template
    const globalTpl = await this.prisma.emailTemplate.findFirst({
      where: {
        key: upperKey,
        customerId: null,
        isActive: true,
        deletedAt: null,
      },
    });
    if (globalTpl) return this.formatTemplate(globalTpl);

    // 3. Fallback to hardcoded predefined system template
    const fallbackDef = PREDEFINED_SYSTEM_TEMPLATES.find((t) => t.key === upperKey);
    if (fallbackDef) {
      return this.formatTemplate({
        id: 0,
        customerId: null,
        key: fallbackDef.key,
        name: fallbackDef.name,
        subject: fallbackDef.subject,
        body: fallbackDef.body,
        description: fallbackDef.description,
        category: fallbackDef.category,
        supportedVariables: fallbackDef.supportedVariables,
        isSystem: true,
        isActive: true,
      });
    }

    return null;
  }

  /**
   * Creates a new email template.
   */
  async create(dto: CreateEmailTemplateDto, customerId?: number | null) {
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;
    const rawKey = dto.identifierKey || dto.key || '';
    const rawName = dto.templateName || dto.name || '';
    const cleanKey = rawKey.trim().toUpperCase().replace(/[\s-]+/g, '_');

    if (!rawName.trim()) {
      throw new BadRequestException('Template name is required');
    }
    if (!cleanKey) {
      throw new BadRequestException('Template identifierKey is required');
    }

    // Check duplicate key within customer scope
    const existing = await this.prisma.emailTemplate.findFirst({
      where: {
        key: cleanKey,
        customerId: numCustomerId,
        deletedAt: null,
      },
    });

    if (existing) {
      throw new BadRequestException(`An email template with key "${cleanKey}" already exists`);
    }

    // Auto-detect variables from subject & body if not explicitly provided
    let variables = dto.supportedVariables || [];
    if (!variables.length) {
      const foundVars = new Set<string>();
      const combined = `${dto.subject} ${dto.body}`;
      const matches = combined.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
      for (const m of matches) {
        if (m[1]) foundVars.add(m[1]);
      }
      variables = Array.from(foundVars);
    }

    const created = await this.prisma.emailTemplate.create({
      data: {
        customerId: numCustomerId,
        name: rawName.trim(),
        key: cleanKey,
        subject: dto.subject.trim(),
        body: dto.body,
        description: dto.description?.trim() || null,
        category: dto.category ? dto.category.trim().toUpperCase() : 'CRM',
        supportedVariables: variables,
        isSystem: false,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
    });

    return this.formatTemplate(created);
  }

  /**
   * Updates an existing email template.
   */
  async update(id: number, dto: UpdateEmailTemplateDto, customerId?: number | null) {
    const template = await this.findOne(id, customerId);

    const updateData: any = {};
    const name = dto.templateName || dto.name;
    if (name !== undefined) updateData.name = name.trim();
    if (dto.subject !== undefined) updateData.subject = dto.subject.trim();
    if (dto.body !== undefined) updateData.body = dto.body;
    if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
    if (dto.category !== undefined) updateData.category = dto.category.trim().toUpperCase();
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    if (dto.supportedVariables !== undefined) {
      updateData.supportedVariables = dto.supportedVariables;
    } else if (dto.body !== undefined || dto.subject !== undefined) {
      const subj = dto.subject !== undefined ? dto.subject : template.subject;
      const bod = dto.body !== undefined ? dto.body : template.body;
      const foundVars = new Set<string>();
      const matches = `${subj} ${bod}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
      for (const m of matches) {
        if (m[1]) foundVars.add(m[1]);
      }
      updateData.supportedVariables = Array.from(foundVars);
    }

    // If key is changed on non-system template, check duplicate
    const key = dto.identifierKey || dto.key;
    if (key && key !== template.key) {
      if (template.isSystem) {
        throw new BadRequestException('The key of a system template cannot be modified');
      }
      const cleanKey = key.trim().toUpperCase().replace(/[\s-]+/g, '_');
      const dup = await this.prisma.emailTemplate.findFirst({
        where: {
          key: cleanKey,
          customerId: template.customerId,
          deletedAt: null,
          id: { not: template.id },
        },
      });
      if (dup) {
        throw new BadRequestException(`A template with key "${cleanKey}" already exists`);
      }
      updateData.key = cleanKey;
    }

    const updated = await this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: updateData,
    });

    return this.formatTemplate(updated);
  }

  /**
   * Sets active status directly.
   */
  async setActive(id: number, isActive: boolean, customerId?: number | null) {
    const template = await this.findOne(id, customerId);
    const updated = await this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: { isActive: Boolean(isActive) },
    });
    return this.formatTemplate(updated);
  }

  /**
   * Toggles active / inactive status of a template.
   */
  async toggleActive(id: number, customerId?: number | null) {
    const template = await this.findOne(id, customerId);
    const updated = await this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: { isActive: !template.isActive },
    });
    return this.formatTemplate(updated);
  }

  /**
   * Duplicates an existing email template.
   */
  async duplicate(id: number, customerId?: number | null) {
    const template = await this.findOne(id, customerId);
    const numCustomerId = customerId && !isNaN(Number(customerId)) && Number(customerId) > 0 ? Number(customerId) : null;

    let candidateKey = `${template.key}_COPY`;
    let counter = 1;
    while (
      await this.prisma.emailTemplate.findFirst({
        where: {
          key: candidateKey,
          customerId: numCustomerId,
          deletedAt: null,
        },
      })
    ) {
      candidateKey = `${template.key}_COPY_${counter++}`;
    }

    const duplicated = await this.prisma.emailTemplate.create({
      data: {
        customerId: numCustomerId,
        name: `${template.name} (Copy)`,
        key: candidateKey,
        subject: template.subject,
        body: template.body,
        description: template.description,
        category: template.category,
        supportedVariables: template.supportedVariables,
        isSystem: false,
        isActive: template.isActive,
      },
    });

    return this.formatTemplate(duplicated);
  }

  /**
   * Soft deletes a user-defined email template.
   */
  async remove(id: number, customerId?: number | null) {
    const template = await this.findOne(id, customerId);
    if (template.isSystem) {
      throw new BadRequestException('System email templates cannot be deleted. You can disable them instead.');
    }

    await this.prisma.emailTemplate.update({
      where: { id: template.id },
      data: { deletedAt: new Date() },
    });

    return { success: true, message: `Email template "${template.name}" deleted successfully` };
  }

  /**
   * Generates a preview with interpolated sample variables.
   */
  preview(dto: PreviewEmailTemplateDto) {
    const isQuikboomLeadTemplate =
      (dto.subject && /QUIKBOOM|Lead|Proposal|Visit/i.test(dto.subject)) ||
      (dto.body && /QUIKBOOM|leadTitle|startDate|startTime/i.test(dto.body));

    const sampleVars: Record<string, any> = {
      companyName: isQuikboomLeadTemplate ? 'QUIKBOOM Digital Marketing Agency' : 'QuickBoom Technologies',
      userName: isQuikboomLeadTemplate ? 'Avinash' : 'John Doe',
      leadTitle: 'Mr. Raj Sharma',
      email: 'sales@quikboom.com',
      startDate: '25 September 2026',
      startTime: '11:30 AM',
      to: 'sales@quikboom.com',
      otp: '682941',
      temporaryPassword: 'QB-' + Math.random().toString(36).slice(-8),
      resetLink: 'https://crm.quikboom.com/reset-password?token=sample-token-123456',
      loginUrl: 'https://crm.quikboom.com/login',
      designation: 'Sales Executive',
      leaveType: 'Casual Leave',
      endDate: '28 September 2026',
      approverName: 'Manager Sarah',
      remarks: 'Approved as per leave policy.',
      rejectionReason: 'Urgent project release during this week.',
      recipientName: 'Mr. Raj Sharma',
      leadContact: 'Mr. Raj Sharma',
      leadPhone: '+91 98765 43210',
      leadCity: 'Pune',
      leadValue: '1,50,000',
      leadNotes: 'Interested in QUIKBOOM Digital Marketing services.',
      customerName: 'Mr. Raj Sharma',
      contactEmail: 'sales@quikboom.com',
      supportPhone: '+91 8000 123 456',
      ...(dto.variables || {}),
    };

    const rendered = renderEmailTemplate(
      { subject: dto.subject, body: dto.body },
      sampleVars,
    );

    return {
      to: sampleVars.to || sampleVars.email || 'sales@quikboom.com',
      subject: rendered.subject,
      body: rendered.body,
      variablesUsed: sampleVars,
      missingVariables: rendered.missingVariables,
    };
  }

  /**
   * Generates a preview for a specific template by ID.
   */
  async previewById(id: number, customerId?: number | null, variables?: Record<string, any>) {
    const template = await this.findOne(id, customerId);
    return this.preview({
      subject: template.subject,
      body: template.body,
      variables,
    });
  }

  /**
   * Returns list of known system template events and placeholders.
   */
  getEventDefinitions() {
    return PREDEFINED_SYSTEM_TEMPLATES.map((t) => ({
      key: t.key,
      identifierKey: t.key,
      name: t.name,
      templateName: t.name,
      category: t.category,
      description: t.description,
      supportedVariables: t.supportedVariables,
    }));
  }
}
