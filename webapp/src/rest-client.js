import { SERVER_API_URL } from "./config.js";

export async function fetchPrograms() {
  const response = await fetch(`${SERVER_API_URL}/programs`);
  return handleResponse(response);
}

export async function getProgram(id) {
  const response = await fetch(`${SERVER_API_URL}/programs/${id}`);
  return handleResponse(response);
}

export async function uploadProgram(program) {
  const response = await fetch(`${SERVER_API_URL}/programs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(program),
  });
  return handleResponse(response);
}

export async function loadProgram(id) {
  const response = await fetch(`${SERVER_API_URL}/programs/${id}/load`, { method: "POST" });
  return handleResponse(response);
}

export async function startProgram() {
  const response = await fetch(`${SERVER_API_URL}/programs/start`, { method: "POST" });
  return handleResponse(response);
}

export async function stopProgram() {
  const response = await fetch(`${SERVER_API_URL}/programs/stop`, { method: "POST" });
  return handleResponse(response);
}

export async function skipToSeries(series_index) {
  const response = await fetch(`${SERVER_API_URL}/programs/series/${series_index}/skip_to`, {
    method: "POST",
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

export async function uploadAudio({ file, codec, title }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("codec", codec);
  formData.append("title", title);

  const response = await fetch(`${SERVER_API_URL}/audios/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(response);
}

export async function deleteAudio(id) {
  const response = await fetch(`${SERVER_API_URL}/audios/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return handleResponse(response);
}

// Target endpoints
export async function showTarget() {
  const response = await fetch(`${SERVER_API_URL}/targets/show`, { method: 'POST' });
  return handleResponse(response);
}

export async function hideTarget() {
  const response = await fetch(`${SERVER_API_URL}/targets/hide`, { method: 'POST' });
  return handleResponse(response);
}

export async function toggleTarget() {
  const response = await fetch(`${SERVER_API_URL}/targets/toggle`, { method: 'POST' });
  return handleResponse(response);
}

async function handleResponse(response) {
  console.log('Response status:', response.status, response.statusText);
  if (!response.ok) {
    throw new Error('Request failed: ${response.statusText}');
  }

  const contentType = response.headers.get("Content-Type");
  if (contentType && contentType.includes("application/json")) {
    return response.json(); // Parse JSON if the response is JSON
  }

  return null; // Return null for empty or non-JSON responses
}