"use client";

import React from "react";
import styles from "./audio-player.module.css";
import { type useStoryVoice } from "../hooks/use-story-voice";

interface AudioPlayerProps {
  text: string;
  id: string;
  label?: string;
  voice: ReturnType<typeof useStoryVoice>;
  showVoicePicker?: boolean;
}

export function AudioPlayer({ text, id, label = "Listen", voice, showVoicePicker = false }: AudioPlayerProps) {
  if (!voice.ttsSupported) return null;

  const isCurrent = voice.currentId === id;
  const isPlayingThis = isCurrent && voice.isSpeaking && !voice.isPaused;
  const isPausedThis = isCurrent && voice.isSpeaking && voice.isPaused;

  const effectiveVol = voice.isMuted ? 0 : voice.volume;
  const level = effectiveVol <= 0.05 ? 0 : effectiveVol <= 0.45 ? 1 : effectiveVol <= 0.75 ? 2 : 3;
  const volPercent = level === 0 ? "0% (Muted)" : level === 1 ? "33%" : level === 2 ? "66%" : "100%";

  return (
    <div className={styles.iconPlayerBar} role="region" aria-label={`Audio player for ${label}`}>
      {/* 1. Play / Pause Icon Button */}
      <button
        type="button"
        className={`${styles.iconBtn} ${isPlayingThis ? styles.iconBtnActive : ""}`}
        onClick={() => voice.speak(text, id)}
        title={isPlayingThis ? "Pause narration" : isPausedThis ? "Resume narration" : `Play ${label}`}
        aria-label={isPlayingThis ? "Pause narration" : isPausedThis ? "Resume narration" : `Play ${label}`}
      >
        {isPlayingThis ? "⏸" : "▶"}
      </button>

      {/* 2. Stop Button (visible while this chapter is active) */}
      {isCurrent && voice.isSpeaking && (
        <button
          type="button"
          className={styles.stopIconBtn}
          onClick={voice.stop}
          title="Stop narration"
          aria-label="Stop narration"
        >
          ⏹
        </button>
      )}

      {/* 3. Microphone with Radiating Sound Waves (Clicking adjusts volume: 0 waves = 0%, 1 wave = 33%, 2 waves = 66%, 3 waves = 100%) */}
      <button
        type="button"
        className={styles.micVolumeBtn}
        onClick={voice.cycleVolume}
        title={`Volume: ${volPercent} (Click to cycle 33% → 66% → 100% → Mute)`}
        aria-label={`Microphone volume level: ${volPercent}. Click to adjust volume.`}
      >
        <svg viewBox="0 0 32 20" width="32" height="20" className={styles.micSvg} aria-hidden="true">
          {/* Microphone Body - centered at Y = 10.0 */}
          <g className={level > 0 ? styles.micActive : styles.micMuted}>
            <rect x="2" y="3.5" width="6" height="8" rx="3" fill="currentColor" />
            <path d="M0.5 7.5 C0.5 11.5 3.5 12.5 5 12.5 C6.5 12.5 9.5 11.5 9.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="5" y1="12.5" x2="5" y2="16.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="2.5" y1="16.5" x2="7.5" y2="16.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </g>

          {/* Radiating Green Sound Waves to the Right: 1 wave = 33%, 2 waves = 66%, 3 waves = 100% */}
          {level >= 1 && (
            <path
              d="M12.5 6.5 A 4.5 4.5 0 0 1 12.5 13.5"
              fill="none"
              stroke="#22c55e"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          )}
          {level >= 2 && (
            <path
              d="M17 4.5 A 7.5 7.5 0 0 1 17 15.5"
              fill="none"
              stroke="#4ade80"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          )}
          {level >= 3 && (
            <path
              d="M21.5 2.5 A 10.5 10.5 0 0 1 21.5 17.5"
              fill="none"
              stroke="#86efac"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          )}
          {level === 0 && (
            <line x1="12" y1="5" x2="20" y2="15" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {/* 4. Multiplier Speed Icon (Clean icon text, no box) */}
      <button
        type="button"
        className={styles.multiplierBtn}
        onClick={voice.cycleRate}
        title="Playback speed multiplier (click to cycle 0.8x, 1x, 1.2x, 1.5x)"
        aria-label="Playback speed multiplier"
      >
        ⚡{voice.rate}×
      </button>

      {/* 5. Voice Selection Dropdown with Icon Prefix (Clean, no box) */}
      {voice.voiceOptions.length > 0 && (
        <div className={styles.voiceSelectWrapper} title="Select narrator voice">
          <span className={styles.voiceIconPrefix}>🗣️</span>
          <select
            className={styles.voiceSelect}
            value={voice.selectedVoiceName}
            onChange={(e) => voice.setSelectedVoiceName(e.target.value)}
            title="Narrator voice selector"
            aria-label="Narrator voice selector"
          >
            {voice.voiceOptions.map((opt) => (
              <option key={opt.name} value={opt.name}>
                {opt.displayName}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
