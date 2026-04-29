const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function request(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function postCommand(message: string, businessId: string) {
  return request('/api/command', {
    method: 'POST',
    body: JSON.stringify({ message, businessId }),
  });
}

export function approveAction(id: string) {
  return request(`/api/actions/${id}/approve`, { method: 'POST' });
}

export function rejectAction(id: string, reason: string) {
  return request(`/api/actions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function getBusinessStats(id: string) {
  return request(`/api/businesses/${id}/stats`);
}

export function updatePermission(businessId: string, actionType: string, rule: string) {
  return request(`/api/permissions/${businessId}/${actionType}`, {
    method: 'PATCH',
    body: JSON.stringify({ rule }),
  });
}

export function updateOperatorMode(businessId: string, mode: string) {
  return request(`/api/businesses/${businessId}/operator-mode`, {
    method: 'PATCH',
    body: JSON.stringify({ mode }),
  });
}

export function getIntegrationStatus(businessId: string) {
  return request(`/api/integrations/status?businessId=${businessId}`);
}

export function connectEmail(payload: {
  businessId: string; provider: string; apiKey?: string;
  smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPass?: string;
  fromEmail: string; fromName: string;
}) {
  return request('/api/integrations/email/connect', { method: 'POST', body: JSON.stringify(payload) });
}

export function testEmail(businessId: string, to: string) {
  return request('/api/integrations/email/test', { method: 'POST', body: JSON.stringify({ businessId, to }) });
}

export function connectSMS(payload: {
  businessId: string; accountSid: string; authToken: string; phoneNumber: string;
}) {
  return request('/api/integrations/sms/connect', { method: 'POST', body: JSON.stringify(payload) });
}

export function testSMS(businessId: string, to: string) {
  return request('/api/integrations/sms/test', { method: 'POST', body: JSON.stringify({ businessId, to }) });
}

export function getAutomations(businessId: string) {
  return request(`/api/automations?businessId=${businessId}`);
}

export function createAutomation(payload: object) {
  return request('/api/automations', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateAutomation(id: string, payload: object) {
  return request(`/api/automations/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export function deleteAutomation(id: string) {
  return request(`/api/automations/${id}`, { method: 'DELETE' });
}

export function toggleAutomation(id: string) {
  return request(`/api/automations/${id}/toggle`, { method: 'POST' });
}

export function testAutomation(id: string, businessId: string, leadId?: string) {
  return request(`/api/automations/${id}/test`, { method: 'POST', body: JSON.stringify({ businessId, leadId }) });
}

export function getAutomationRuns(id: string) {
  return request(`/api/automations/${id}/runs`);
}
