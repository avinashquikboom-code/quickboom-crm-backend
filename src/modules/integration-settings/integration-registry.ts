export type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  group?: 'credentials' | 'config' | 'environment';
  type?: 'text' | 'password' | 'number' | 'select' | 'boolean';
  options?: string[];
  placeholder?: string;
};

export type IntegrationDefinition = {
  provider: string;
  displayName: string;
  category: string;
  fields: IntegrationField[];
};

export const INTEGRATION_REGISTRY: IntegrationDefinition[] = [
  {
    provider: 'GOOGLE_MAPS',
    displayName: 'Google Maps',
    category: 'Maps',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, required: true },
      { key: 'mapId', label: 'Map ID', group: 'config', placeholder: 'Optional' },
      { key: 'mapsJs', label: 'Maps JavaScript API', type: 'boolean', group: 'config' },
      { key: 'places', label: 'Places API', type: 'boolean', group: 'config' },
      { key: 'geocoding', label: 'Geocoding API', type: 'boolean', group: 'config' },
      { key: 'directions', label: 'Directions API', type: 'boolean', group: 'config' },
    ],
  },
  {
    provider: 'RAZORPAY',
    displayName: 'Razorpay',
    category: 'Payments',
    fields: [
      { key: 'environment', label: 'Environment', group: 'environment', type: 'select', options: ['TEST', 'LIVE'], required: true },
      { key: 'keyId', label: 'Key ID', required: true },
      { key: 'keySecret', label: 'Key Secret', secret: true, required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', secret: true },
    ],
  },
  {
    provider: 'WHATSAPP',
    displayName: 'WhatsApp Business',
    category: 'Messaging',
    fields: [
      { key: 'accessToken', label: 'Access Token', secret: true, required: true },
      { key: 'phoneNumberId', label: 'Phone Number ID', required: true },
      { key: 'businessAccountId', label: 'Business Account ID', required: true },
      { key: 'appSecret', label: 'App Secret', secret: true },
      { key: 'verifyToken', label: 'Webhook Verify Token', secret: true },
      { key: 'apiVersion', label: 'API Version', placeholder: 'v21.0' },
    ],
  },
  {
    provider: 'AWS',
    displayName: 'AWS S3',
    category: 'Storage',
    fields: [
      { key: 'accessKeyId', label: 'Access Key ID', required: true },
      { key: 'secretAccessKey', label: 'Secret Access Key', secret: true, required: true },
      { key: 'region', label: 'Region', required: true, placeholder: 'ap-south-1' },
      { key: 'bucket', label: 'Bucket Name', required: true },
    ],
  },
  {
    provider: 'MSG91',
    displayName: 'MSG91',
    category: 'Messaging',
    fields: [
      { key: 'authKey', label: 'API Key', secret: true, required: true },
      { key: 'senderId', label: 'Sender ID' },
      { key: 'templateId', label: 'Template ID' },
      { key: 'otpExpiry', label: 'OTP expiry seconds', type: 'number', group: 'config' },
    ],
  },
  {
    provider: 'OPENAI',
    displayName: 'OpenAI',
    category: 'AI',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, required: true },
      { key: 'imageModel', label: 'Model', placeholder: 'gpt-4o-mini' },
    ],
  },
  {
    provider: 'GEMINI',
    displayName: 'Google Gemini',
    category: 'AI',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, required: true },
      { key: 'model', label: 'Model', group: 'config', placeholder: 'gemini-2.0-flash' },
    ],
  },
  {
    provider: 'SMTP',
    displayName: 'SMTP Email',
    category: 'Email',
    fields: [
      { key: 'host', label: 'Host', group: 'config', required: true },
      { key: 'port', label: 'Port', type: 'number', group: 'config', required: true },
      { key: 'username', label: 'Username', required: true },
      { key: 'password', label: 'Password', secret: true, required: true },
      { key: 'security', label: 'Encryption', type: 'select', group: 'config', options: ['TLS', 'SSL', 'NONE'], required: true },
      { key: 'fromEmail', label: 'From Email', group: 'config', required: true },
      { key: 'fromName', label: 'From Name', group: 'config' },
    ],
  },
  {
    provider: 'FIREBASE',
    displayName: 'Firebase',
    category: 'Messaging',
    fields: [
      { key: 'projectId', label: 'Project ID', required: true },
      { key: 'clientEmail', label: 'Client Email', required: true },
      { key: 'privateKey', label: 'Private Key', secret: true, required: true },
      { key: 'messagingSenderId', label: 'Messaging Sender ID' },
    ],
  },
];

export function integrationDefinition(provider: string) {
  return INTEGRATION_REGISTRY.find((item) => item.provider === provider) || null;
}
