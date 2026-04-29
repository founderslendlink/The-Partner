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
