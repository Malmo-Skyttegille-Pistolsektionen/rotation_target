export async function fetchPrograms() {
  const res = await fetch("/programs");
  return res.json();
}

export async function getProgram(id) {
  const res = await fetch(`/programs/${id}`);
  if (!res.ok) throw new Error("Program not found");
  return res.json();
}

export function uploadProgram(program) {
  return fetch("/programs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(program)
  });
}

export function loadProgram(id) {
  return fetch(`/programs/${id}/load`, { method: "POST" });
}

export function startProgram() {
  return fetch("/programs/start", { method: "POST" });
}

export function stopProgram() {
  return fetch("/programs/stop", { method: "POST" });
}

export function skipToSeries(series_index) {
  return fetch("/programs/skip_to", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ series_index })
  });
}

export async function getStatus() {
  const res = await fetch("/status");
  return res.json();
}

export async function fetchAudios() {
  const res = await fetch("/audios");
  return res.json();
}

export function uploadAudio({ file, codec, title }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("codec", codec);
  formData.append("title", title);

  return fetch("/audios/upload", {
    method: "POST",
    body: formData
  });
}

export function deleteAudio(id) {
  return fetch("/audios/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
}

export async function turnTargets() {
  const res = await fetch(`/api/target/turn`, { method: 'POST' });
  if (!res.ok) throw new Error("Failed to turn targets");
  return res.json();
}