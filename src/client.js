/**
 * A small client for the SMSTunnel API (Node.js has fetch).
 *
 * Every call resolves with the decoded answer, or rejects with an SmsTunnelError that carries the HTTP status
 * (0 when SMSTunnel could not be reached), SMSTunnel's error code (e.g. PERMISSION_REQUIRED) and, for a 429, the
 * seconds to wait.
 */

export const DEFAULT_SERVER_URL = 'https://smstunnel.io';
const SERVER_URL = /^https?:\/\/[^/\s?#]+(\/[^\s?#]*)?$/i;

export class SmsTunnelError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SmsTunnelError';
    this.status = details.status ?? 0;
    this.code = details.code;
    this.permission = details.permission;
    this.retryAfter = details.retryAfter;
    this.body = details.body;
  }
}

/** The words of an error body, whatever its shape. */
export function errorMessageOf(body, status) {
  if (typeof body === 'string' && body.trim()) {
    const text = body
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text.slice(0, 300);
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const message = Array.isArray(body.message)
      ? body.message.filter((part) => typeof part === 'string').join('; ')
      : body.message;
    if (typeof message === 'string' && message) return message;
    if (typeof body.error === 'string' && body.error) return body.error;
  }
  return `SMSTunnel returned error: ${status}`;
}

/** Seconds from a Retry-After header (a number or an HTTP date), or undefined. */
function retryAfterOf(value) {
  if (!value) return undefined;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const date = Date.parse(text);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

function errorFromResponse(status, body, headers) {
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  return new SmsTunnelError(errorMessageOf(body, status), {
    status,
    code: typeof fields.code === 'string' ? fields.code : undefined,
    permission: typeof fields.permission === 'string' ? fields.permission : undefined,
    retryAfter: status === 429 ? retryAfterOf(headers?.get('retry-after')) : undefined,
    body,
  });
}

export function normalizeServerUrl(serverUrl) {
  const url = String(serverUrl || DEFAULT_SERVER_URL)
    .trim()
    .replace(/\/+$/, '');
  if (!SERVER_URL.test(url)) {
    throw new Error(`server-url must look like https://smstunnel.io (got "${serverUrl}").`);
  }
  return url;
}

/**
 * @param {{apiKey: string, serverUrl?: string, timeoutMs?: number, userAgent?: string}} options
 */
export function createClient(options) {
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) throw new Error('An SMSTunnel API key is required.');
  const serverUrl = normalizeServerUrl(options.serverUrl);
  const timeoutMs = options.timeoutMs || 30000;
  const origin = new URL(serverUrl).origin;

  async function request(method, path, body) {
    const headers = { 'X-API-Key': apiKey, Accept: 'application/json' };
    if (options.userAgent) headers['User-Agent'] = options.userAgent;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const timeout = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch(serverUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Never follow a redirect: the key must not be sent to another address.
        redirect: 'manual',
        signal: timeout,
      });
    } catch (error) {
      const reason = timeout.aborted
        ? `no answer within ${timeoutMs / 1000} s`
        : error?.cause?.code || error?.message || String(error);
      throw new SmsTunnelError(`Could not reach SMSTunnel at ${origin}: ${reason}`);
    }

    const text = await response.text();
    let data;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      throw new SmsTunnelError(
        location
          ? `SMSTunnel answered with a redirect to ${location}. Set server-url to that address.`
          : `SMSTunnel answered with a redirect (${response.status}).`,
        { status: response.status, body: data },
      );
    }
    if (!response.ok) throw errorFromResponse(response.status, data, response.headers);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new SmsTunnelError('SMSTunnel answered with something that is not JSON.', {
        status: response.status,
        body: data,
      });
    }
    if (data.success === false) throw errorFromResponse(response.status, data, response.headers);
    return data;
  }

  function sendBody(to, message, extra = {}) {
    const body = { to: String(to).trim(), message: String(message) };
    if (extra.deviceId) body.deviceId = String(extra.deviceId).trim();
    if (extra.defaultCountryCode) body.defaultCountryCode = String(extra.defaultCountryCode).trim();
    return body;
  }

  return {
    serverUrl,

    /** POST /api/v1/sms/send: one text to one number. */
    sendSms(to, message, extra) {
      return request('POST', '/api/v1/sms/send', sendBody(to, message, extra));
    },

    /** POST /api/v1/sms/send-2fa: a sign-in code (the text must contain 4 to 10 digits). */
    sendVerificationCode(to, message, extra) {
      return request('POST', '/api/v1/sms/send-2fa', sendBody(to, message, extra));
    },
  };
}
