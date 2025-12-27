import { SERVER_API_URL } from "../ui/views/settings_tab.js";

export const HTTP_METHOD = Object.freeze({
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  DELETE: "DELETE",
  PATCH: "PATCH"
});

export async function getPrograms() {
  const response = await fetch(`${SERVER_API_URL}/programs`);
  return handleResponse(response);
}

export async function getProgram(id) {
  const response = await fetch(`${SERVER_API_URL}/programs/${id}`);
  return handleResponse(response);
}

export async function uploadProgram(program, id) {
  const url = id ? `${SERVER_API_URL}/programs/${id}/update` : `${SERVER_API_URL}/programs`;
  const method = id ? HTTP_METHOD.PUT : HTTP_METHOD.POST;
  const response = await fetchWithAuth(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(program)
  });
  return handleResponse(response);
}

export async function deleteProgram(id) {
  const response = await fetchWithAuth(`${SERVER_API_URL}/programs/${id}/delete`, {
    method: HTTP_METHOD.DELETE,
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse(response);
}

export async function loadProgram(id) {
  const response = await fetchWithAuth(`${SERVER_API_URL}/programs/${id}/load`, { method: "POST" });
  return handleResponse(response);
}

export async function startProgram() {
  const response = await fetchWithAuth(`${SERVER_API_URL}/programs/start`, { method: "POST" });
  return handleResponse(response);
}

export async function stopProgram() {
  const response = await fetchWithAuth(`${SERVER_API_URL}/programs/stop`, { method: "POST" });
  return handleResponse(response);
}

export async function skipToSeries(series_index) {
  const response = await fetchWithAuth(`${SERVER_API_URL}/programs/series/${series_index}/skip_to`, {
    method: HTTP_METHOD.POST,
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse(response);
}

export async function getStatus() {
  const response = await fetch(`${SERVER_API_URL}/status`);
  return handleResponse(response);
}

export async function fetchAudios() {
  const response = await fetch(`${SERVER_API_URL}/audios`);
  return handleResponse(response);
}

export async function uploadAudio(file, codec, title) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("codec", codec);
  formData.append("title", title);

  const response = await fetchWithAuth(`${SERVER_API_URL}/audios`, {
    method: HTTP_METHOD.POST,
    body: formData,
  });
  return handleResponse(response);
}

export async function deleteAudio(id) {
  const response = await fetchWithAuth(`${SERVER_API_URL}/audios/${id}/delete`, {
    method: HTTP_METHOD.DELETE,
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse(response);
}

// Target endpoints
export async function showTargets() {
  const response = await fetchWithAuth(`${SERVER_API_URL}/targets/show`, { method: 'POST' });
  return handleResponse(response);
}

export async function hideTargets() {
  const response = await fetchWithAuth(`${SERVER_API_URL}/targets/hide`, { method: 'POST' });
  return handleResponse(response);
}

export async function toggleTargets() {
  const response = await fetchWithAuth(`${SERVER_API_URL}/targets/toggle`, { method: 'POST' });
  return handleResponse(response);
}

export async function fetchAdminModeStatus() {
  const response = await fetch(`${SERVER_API_URL}/admin-mode/status`);
  return handleResponse(response);
}

export async function enableAdminMode(password) {
  // Do NOT use fetchWithAuth here, since we don't have a token yet!
  const response = await fetch(`${SERVER_API_URL}/admin-mode/enable`, {
    method: HTTP_METHOD.POST,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return handleResponse(response);
}

export async function disableAdminMode() {
  const response = await fetchWithAuth(`${SERVER_API_URL}/admin-mode/disable`, {
    method: HTTP_METHOD.POST,
  });
  return handleResponse(response);
}

export async function playAudio(id) {
  const response = await fetchWithAuth(`${SERVER_API_URL}/audios/${id}/play`, {
    method: HTTP_METHOD.POST,
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse(response);
}

async function handleResponse(response) {
  if (!response.ok) {
    throw new Error(`Request failed: ${response.statusText}`);
  }

  const contentType = response.headers.get("Content-Type");
  if (contentType && contentType.includes("application/json")) {
    return response.json(); // Parse JSON if the response is JSON
  }

  return null; // Return null for empty or non-JSON responses
}

async function fetchWithAuth(input, init = {}) {
  const token = localStorage.getItem("ADMIN_BEARER_TOKEN");
  init.headers = init.headers || {};
  if (token) {
    init.headers["Authorization"] = `Bearer ${token}`;
  }
  return await fetch(input, init);
}