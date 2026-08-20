import { fetchAudios } from '../apis/rest-client.js';

export let audios = [];

export async function loadAudios() {
    const data = await fetchAudios();

    audios = data.audios || [];

    return audios;
}

export function getAudioTitleById(id) {
    const audio = audios.find(a => a.id === id);
    return audio ? audio.title : undefined;
}
