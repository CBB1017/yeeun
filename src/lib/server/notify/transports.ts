import { config } from '../config';
import { AppError } from '../errors';

/**
 * Delivery transports. Real implementations use nodemailer (SMTP over TLS)
 * and web-push (VAPID). Tests inject fakes through the same interface.
 * "Success" means the SMTP server / push service accepted the message; it
 * never means a human read it.
 */

export interface SmtpSender {
	source: 'profile' | 'operator_default';
	profileId: string | null;
	host: string;
	port: number;
	/** true = implicit TLS (465); false = STARTTLS is required (never plaintext). */
	secure: boolean;
	username?: string;
	password?: string;
	/** Verified From address of the profile. Never taken from user input at send time. */
	fromAddress: string;
}

export interface MailMessage {
	from: string;
	to: string;
	subject: string;
	text: string;
}

export interface PushTarget {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export interface Transports {
	sendMail(profile: SmtpSender, msg: MailMessage): Promise<void>;
	sendPush(subscription: PushTarget, payload: string): Promise<void>;
	/** SMTP connection + authentication check (nodemailer `verify()`). */
	verifyMail(profile: SmtpSender): Promise<void>;
}

const SMTP_TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

async function smtpTransport(profile: SmtpSender) {
	const nodemailer = (await import('nodemailer')).default;
	return nodemailer.createTransport({
		host: profile.host,
		port: profile.port,
		secure: profile.secure,
		requireTLS: !profile.secure,
		auth: profile.username ? { user: profile.username, pass: profile.password ?? '' } : undefined,
		tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
		...SMTP_TIMEOUTS,
		disableFileAccess: true,
		disableUrlAccess: true
	});
}

/** Error carrying an HTTP status from the push service (404/410 = subscription gone). */
export class PushDeliveryError extends Error {
	constructor(
		message: string,
		public statusCode: number | undefined
	) {
		super(message);
		this.name = 'PushDeliveryError';
	}
}

export function realTransports(): Transports {
	return {
		async sendMail(profile, msg) {
			const t = await smtpTransport(profile);
			try {
				const info = await t.sendMail({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text });
				const rejected = (info.rejected ?? []) as unknown[];
				const accepted = (info.accepted ?? []) as unknown[];
				if (rejected.length > 0 || accepted.length === 0) {
					throw new AppError('DELIVERY_FAILED', 'SMTP server did not accept the recipient');
				}
			} finally {
				t.close();
			}
		},
		async verifyMail(profile) {
			const t = await smtpTransport(profile);
			try {
				await t.verify();
			} finally {
				t.close();
			}
		},
		async sendPush(subscription, payload) {
			const v = config().vapid;
			if (!v.publicKey || !v.privateKey || !v.subject) {
				throw new AppError('NOT_CONFIGURED', 'push not configured (VAPID keys missing)');
			}
			const webpush = (await import('web-push')).default;
			try {
				await webpush.sendNotification(subscription, payload, {
					vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
					TTL: 24 * 3600,
					timeout: 15_000
				});
			} catch (err) {
				const status = (err as { statusCode?: number }).statusCode;
				throw new PushDeliveryError(
					status ? `push service responded ${status}` : `push send failed: ${(err as Error).message ?? 'unknown'}`,
					status
				);
			}
		}
	};
}
