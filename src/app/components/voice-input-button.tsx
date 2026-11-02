"use client";

import React from "react";
import styles from "./audio-player.module.css";
import { type useStoryVoice } from "../hooks/use-story-voice";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  voice: ReturnType<typeof useStoryVoice>;
  title?: string;
}

export function VoiceInputButton({ onTranscript, voice, title = "Dictate with voice" }: VoiceInputButtonProps) {
  if (!voice.sttSupported) return null;

  const handleClick = () => {
    if (voice.isListening) {
      voice.stopDictation();
    } else {
      voice.startDictation((newText) => {
        onTranscript(newText);
      });
    }
  };

  return (
    <button
      type="button"
      className={`${styles.micBtn} ${voice.isListening ? styles.micBtnActive : ""}`}
      onClick={handleClick}
      title={voice.isListening ? "Listening... click to stop" : title}
      aria-label={voice.isListening ? "Listening... click to stop" : title}
    >
      {voice.isListening ? "🛑" : "🎙️"}
    </button>
  );
}
