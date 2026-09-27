/**
 * Mail abstraction: real SMTP via nodemailer when configured, honest
 * dev-log fallback otherwise (non-production only — production without
 * SMTP refuses to send instead of leaking tokens into logs).
 */
import { logger } from '../../common/logging/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

function smtpConfigured(): boolean {
  const host = process.env['SMTP_HOST'] ?? '';
  return host !== '' && !host.includes('PASTE_YOUR');
}

export async function sendMail(msg: MailMessage): Promise<{ delivered: boolean; devLogged: boolean }> {
  if (!smtpConfigured()) {
    if (process.env['NODE_ENV'] === 'production') {
      logger.error('SMTP not configured — refusing to send mail in production');
      return { delivered: false, devLogged: false };
    }
    logger.info({ to: msg.to, subject: msg.subject }, '[dev-mail] message logged instead of sent');
    logger.info({ text: msg.text }, '[dev-mail] body (dev only — never logged in production)');
    return { delivered: false, devLogged: true };
  }
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: process.env['SMTP_HOST'],
    port: Number(process.env['SMTP_PORT'] ?? 587),
    secure: Number(process.env['SMTP_PORT'] ?? 587) === 465,
    auth: process.env['SMTP_USER'] !== undefined && !(process.env['SMTP_USER'] ?? '').includes('PASTE_YOUR')
      ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] ?? '' }
      : undefined,
  });
  await transport.sendMail({
    from: process.env['MAIL_FROM'] ?? 'no-reply@example.com',
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
  });
  return { delivered: true, devLogged: false };
}
