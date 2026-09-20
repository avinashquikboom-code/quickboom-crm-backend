import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  Req,
  Res,
  HttpStatus,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { WhatsappService } from './whatsapp.service';

@ApiTags('WhatsApp Webhooks')
@Controller(['webhooks/whatsapp', 'whatsapp/webhook'])
export class WhatsappWebhookController {
  private readonly logger = new Logger(WhatsappWebhookController.name);

  constructor(private readonly whatsappService: WhatsappService) {}

  /**
   * Meta WhatsApp Cloud API Webhook Verification.
   * Meta issues a GET request with query params:
   * - hub.mode: "subscribe"
   * - hub.verify_token: configured token
   * - hub.challenge: numeric challenge string
   *
   * Must return raw challenge text with HTTP 200 when valid, or HTTP 403 on failure.
   */
  @Get()
  @ApiOperation({ summary: 'Meta WhatsApp Cloud API Webhook verification endpoint' })
  @ApiQuery({ name: 'hub.mode', required: true, description: 'Subscribe mode' })
  @ApiQuery({ name: 'hub.verify_token', required: true, description: 'Configured verification token' })
  @ApiQuery({ name: 'hub.challenge', required: true, description: 'Challenge code to echo back' })
  @ApiResponse({ status: 200, description: 'Challenge echoed back as raw text' })
  @ApiResponse({ status: 403, description: 'Verification token mismatch' })
  async verifyWebhook(
    @Query('hub.mode') modeParam: string,
    @Query('hub.verify_token') verifyTokenParam: string,
    @Query('hub.challenge') challengeParam: string,
    @Res() res: Response,
    @Req() req?: Request,
  ) {
    const query = ((req as any)?.query || {}) as Record<string, any>;
    const hub = typeof query.hub === 'object' && query.hub !== null ? query.hub : {};

    const mode = (
      query['hub.mode'] ||
      hub.mode ||
      query.mode ||
      modeParam ||
      ''
    ).toString();

    const verifyToken = (
      query['hub.verify_token'] ||
      hub.verify_token ||
      query.verify_token ||
      query.verifyToken ||
      verifyTokenParam ||
      ''
    ).toString();

    const challenge = (
      query['hub.challenge'] ||
      hub.challenge ||
      query.challenge ||
      challengeParam ||
      ''
    ).toString();

    const result = await this.whatsappService.verifyWebhookToken(mode, verifyToken, challenge);
    if (!result.valid) {
      this.logger.warn('[WHATSAPP_WEBHOOK] Verification failed: invalid verify_token or mode');
      return res.status(HttpStatus.FORBIDDEN).type('text/plain').send('Verification token mismatch');
    }

    // Return raw challenge text with 200 OK (bypasses JSON interceptor wrapper)
    return res.status(HttpStatus.OK).type('text/plain').send(result.challenge);
  }

  /**
   * Meta WhatsApp Cloud API Webhook Event Receiver.
   * Receives incoming messages, delivery statuses, errors, etc.
   * Returns HTTP 200 immediately.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Meta WhatsApp Cloud API Webhook event receiver' })
  @ApiResponse({ status: 200, description: 'Webhook event received and processed' })
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // 1. Signature verification if App Secret configured
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(payload);
    const isSignatureValid = await this.whatsappService.verifyMetaSignature(rawBody, signature);
    if (!isSignatureValid) {
      this.logger.warn('[WHATSAPP_WEBHOOK] Rejected request with invalid X-Hub-Signature-256');
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Invalid webhook signature' });
    }

    // 2. Process payload safely without exposing internal details on failure
    try {
      await this.whatsappService.processWebhookPayload(payload);
    } catch (err: any) {
      this.logger.error(`[WHATSAPP_WEBHOOK_PROCESSING_ERROR] ${err?.message}`);
    }

    // 3. Return HTTP 200 quickly to Meta
    return res.status(HttpStatus.OK).json({ status: 'ok' });
  }
}
