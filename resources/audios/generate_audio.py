#!/usr/bin/env python3

import os
import wave
import json
from pathlib import Path
from google import genai
from google.genai import types


def wave_file(filename, pcm, channels=1, rate=24000, sample_width=2):
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm)
    print(
        f"WAV file saved as {filename} (channels={channels}, rate={rate}, width={sample_width})"
    )


def generate(messages):
    client = genai.Client(
        api_key=os.environ.get("GEMINI_API_KEY"),
    )

    model = "gemini-2.5-pro-preview-tts"

    STYLE = (
        "Använd en autentisk skånsk kvinnlig röst som ger instruktioner/kommandon till skyttar under en skyttetävling. "
        "Den behöver vara tydligt och bestämt! Det du ska säga är:"
    )

    index = {}

    for key, value in messages.items():
        filename = value["filename"]

        print(f"Generating audio for {key}: {value['phrase']} (filename: {filename})")
        prompt = STYLE + value["phrase"]
        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=prompt),
                ],
            ),
        ]
        generate_content_config = types.GenerateContentConfig(
            temperature=1,
            response_modalities=["audio"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Zephyr")
                )
            ),
        )

        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=generate_content_config,
        )
        if (
            response is not None
            and hasattr(response, "candidates")
            and response.candidates
            and hasattr(response.candidates[0], "content")
            and response.candidates[0].content is not None
            and hasattr(response.candidates[0].content, "parts")
            and response.candidates[0].content.parts
        ):
            part = response.candidates[0].content.parts[0]
            if (
                hasattr(part, "inline_data")
                and part.inline_data
                and part.inline_data.data
            ):
                print(
                    f"Saving {filename} with {len(part.inline_data.data)} bytes of PCM data"
                )
                out_path = Path("files") / filename
                out_path.parent.mkdir(parents=True, exist_ok=True)
                wave_file(
                    str(out_path),
                    part.inline_data.data,
                    channels=1,
                    rate=24000,
                    sample_width=2,
                )
            else:
                print(f"Error: No inline_data found for {filename}")
        else:
            print(f"Error: Invalid response for {filename}: {response}")


if __name__ == "__main__":
    FROM_ID = 33
    TO_ID = 33
    # Load messages from audios.json
    with open("audios.json", "r", encoding="utf-8") as f:
        messages = json.load(f)
        filtered = {k: v for k, v in messages.items() if FROM_ID <= int(k) <= TO_ID}
        generate(filtered)
