import { SERVER_URL } from "./config.js";

export async function fetchPrograms() {
  const response = await fetch(`${SERVER_URL}/programs`);
  return handleResponse(response);
}

export async function getProgram(id) {
  const response = await fetch(`${SERVER_URL}/programs/${id}`);
  return handleResponse(response);
}

export async function uploadProgram(program) {
  const response = await fetch(`${SERVER_URL}/programs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(program),
  });
  return handleResponse(response);
}

export async function loadProgram(id) {
  const response = await fetch(`${SERVER_URL}/programs/${id}/load`, { method: "POST" });
  return handleResponse(response);
}

export async function startProgram() {
  const response = await fetch(`${SERVER_URL}/programs/start`, { method: "POST" });
  return handleResponse(response);
}

export async function stopProgram() {
  const response = await fetch(`${SERVER_URL}/programs/stop`, { method: "POST" });
  return handleResponse(response);
}

export async function skipToSeries(series_index) {
  const response = await fetch(`${SERVER_URL}/programs/skip_to`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ series_index }),
  });
  return handleResponse(response);
}

export async function getStatus() {
  const response = await fetch(`${SERVER_URL}/status`);
  return handleResponse(response);
}

export async function fetchAudios() {
  const response = await fetch(`${SERVER_URL}/audios`);
  return handleResponse(response);
}

export async function uploadAudio({ file, codec, title }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("codec", codec);
  formData.append("title", title);

  const response = await fetch(`${SERVER_URL}/audios/upload`, {
    method: "POST",
    body: formData,
  });
  return handleResponse(response);
}

export async function deleteAudio(id) {
  const response = await fetch(`${SERVER_URL}/audios/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  return handleResponse(response);
}

export async function turnTargets() {
  const response = await fetch(`${SERVER_URL}/api/target/turn`, { method: "POST" });
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