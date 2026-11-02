"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface VoiceOption {
  name: string;
  lang: string;
  displayName: string;
  gender: "female" | "male" | "neutral";
  isNatural: boolean;
}

const VOICE_PREF_KEY = "weaver_preferred_voice_name";

function formatVoiceName(v: SpeechSynthesisVoice): { displayName: string; gender: "female" | "male" | "neutral"; isNatural: boolean } {
  const name = v.name;
  const isNatural = name.includes("Natural") || name.includes("Online") || name.includes("Google");
  
  const lower = name.toLowerCase();
  const isFemale = lower.includes("jenny") || lower.includes("aria") || lower.includes("zira") || lower.includes("samantha") || lower.includes("sonia") || lower.includes("female") || lower.includes("karen") || lower.includes("victoria") || lower.includes("michelle") || lower.includes("ana");
  const isMale = lower.includes("guy") || lower.includes("david") || lower.includes("mark") || lower.includes("christopher") || lower.includes("ryan") || lower.includes("male") || lower.includes("daniel") || lower.includes("steffan");
  const gender = isFemale ? "female" : isMale ? "male" : "neutral";

  // Clean friendly display name
  let clean = name
    .replace(/^Microsoft\s+/i, "")
    .replace(/\s+Online\s+\(Natural\)/i, " (Natural)")
    .replace(/\s+Desktop/i, "")
    .replace(/-\s+English\s+\([^)]+\)/i, "")
    .trim();

  const icon = gender === "female" ? "👩" : gender === "male" ? "👨" : "🎙️";
  const badge = isNatural ? "★" : "";
  const displayName = `${icon} ${clean} ${badge}`.trim();

  return { displayName, gender, isNatural };
}

interface TextChunk {
  text: string;
  startChar: number;
  endChar: number;
}

/**
 * Splits story text into sentence or clause chunks (~150-250 characters each).
 * This prevents Chromium's SpeechDispatcher buffer overflow on long texts (all 3 chapters)
 * and bypasses the 15-second browser speech cutoff bug.
 */
function chunkTextForSpeech(fullText: string): TextChunk[] {
  if (!fullText) return [];

  const chunks: TextChunk[] = [];
  const regex = /[^.!?\n]+(?:[.!?]+(?:\s+|$)|(?:\n+|$))/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(fullText)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const leadingWhitespace = raw.match(/^\s*/)?.[0]?.length ?? 0;
    const startChar = match.index + leadingWhitespace;
    const endChar = startChar + trimmed.length;

    // Strip markdown formatting symbols for speech clarity
    const spoken = trimmed.replace(/[#*_`~>]/g, " ").replace(/\s+/g, " ").trim();
    if (!spoken) continue;

    // Subdivide extremely long sentences at clauses
    if (spoken.length > 220) {
      const clauseRegex = /[^,;:—\n]+(?:[,;:—\n]+(?:\s+|$)|$)/g;
      let clauseMatch: RegExpExecArray | null;
      while ((clauseMatch = clauseRegex.exec(trimmed)) !== null) {
        const cRaw = clauseMatch[0];
        const cTrimmed = cRaw.trim();
        if (!cTrimmed) continue;
        const cLead = cRaw.match(/^\s*/)?.[0]?.length ?? 0;
        const cStart = startChar + clauseMatch.index + cLead;
        const cSpoken = cTrimmed.replace(/[#*_`~>]/g, " ").replace(/\s+/g, " ").trim();
        if (cSpoken) {
          chunks.push({
            text: cSpoken,
            startChar: cStart,
            endChar: cStart + cTrimmed.length,
          });
        }
      }
    } else {
      chunks.push({
        text: spoken,
        startChar,
        endChar,
      });
    }
  }

  if (chunks.length === 0 && fullText.trim()) {
    const trimmed = fullText.trim();
    const leading = fullText.indexOf(trimmed);
    chunks.push({
      text: trimmed.replace(/[#*_`~>]/g, " "),
      startChar: Math.max(0, leading),
      endChar: Math.max(0, leading) + trimmed.length,
    });
  }

  return chunks;
}

export function useStoryVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [rate, setRateState] = useState(1.0);
  const [volume, setVolumeState] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [spokenCharIndex, setSpokenCharIndex] = useState<number>(-1);
  const [spokenCharLength, setSpokenCharLength] = useState<number>(0);
  const [isListening, setIsListening] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [selectedVoiceName, setSelectedVoiceNameState] = useState<string>("");

  const prevVolumeRef = useRef<number>(1.0);
  const recognitionRef = useRef<any>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const availableVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const chunksRef = useRef<TextChunk[]>([]);
  const chunkIndexRef = useRef<number>(0);
  const currentTextRef = useRef<string>("");
  const currentIdRef = useRef<string | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const isCancelledRef = useRef<boolean>(false);
  const lastBoundaryTimeRef = useRef<number>(0);
  const rateRef = useRef<number>(rate);
  const volumeRef = useRef<number>(volume);
  const isMutedRef = useRef<boolean>(isMuted);

  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Load saved volume
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedVol = localStorage.getItem("weaver_voice_volume");
      if (savedVol !== null) {
        const v = parseFloat(savedVol);
        if (!isNaN(v) && v >= 0 && v <= 1) {
          setVolumeState(v);
          if (v === 0) setIsMuted(true);
        }
      }
    }
  }, []);

  // Load and classify available voices
  const refreshVoices = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const rawVoices = window.speechSynthesis.getVoices();
    if (!rawVoices || rawVoices.length === 0) return;

    availableVoicesRef.current = rawVoices;

    // Filter to English voices
    const enVoices = rawVoices.filter(v => v.lang.startsWith("en") || !v.lang);
    const options: VoiceOption[] = (enVoices.length > 0 ? enVoices : rawVoices).map(v => {
      const meta = formatVoiceName(v);
      return {
        name: v.name,
        lang: v.lang,
        displayName: meta.displayName,
        gender: meta.gender,
        isNatural: meta.isNatural,
      };
    });

    // Sort: Natural female voices first, then other natural, then standard female, then male
    options.sort((a, b) => {
      if (a.isNatural && !b.isNatural) return -1;
      if (!a.isNatural && b.isNatural) return 1;
      if (a.gender === "female" && b.gender !== "female") return -1;
      if (a.gender !== "female" && b.gender === "female") return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    setVoiceOptions(options);

    // Load saved voice or choose best natural female voice
    const saved = localStorage.getItem(VOICE_PREF_KEY);
    const matchedSaved = saved && rawVoices.some(v => v.name === saved);
    if (matchedSaved) {
      setSelectedVoiceNameState(saved);
    } else {
      // Pick best natural female voice
      const bestDefault = options.find(o => o.isNatural && o.gender === "female")
        || options.find(o => o.gender === "female")
        || options.find(o => o.isNatural)
        || options[0];
      if (bestDefault) {
        setSelectedVoiceNameState(bestDefault.name);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setTtsSupported("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setSttSupported(Boolean(SpeechRec));

      refreshVoices();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = refreshVoices;
      }
    }
  }, [refreshVoices]);

  const setSelectedVoiceName = useCallback((name: string) => {
    setSelectedVoiceNameState(name);
    if (typeof window !== "undefined") {
      localStorage.setItem(VOICE_PREF_KEY, name);
    }
  }, []);

  // Stop active speech on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  const stop = useCallback(() => {
    isCancelledRef.current = true;
    isSpeakingRef.current = false;
    isPausedRef.current = false;
    currentIdRef.current = null;
    chunksRef.current = [];
    chunkIndexRef.current = 0;
    activeUtteranceRef.current = null;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentId(null);
    setSpokenCharIndex(-1);
    setSpokenCharLength(0);
  }, []);

  const pause = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
      window.speechSynthesis.pause();
      isPausedRef.current = true;
      setIsPaused(true);
    }
  }, []);

  const playChunk = useCallback((index: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (isCancelledRef.current || !isSpeakingRef.current) return;

    const chunks = chunksRef.current;
    if (!chunks || index >= chunks.length) {
      // Completed narration
      stop();
      return;
    }

    chunkIndexRef.current = index;
    const chunk = chunks[index];
    const fullText = currentTextRef.current;

    const utterance = new SpeechSynthesisUtterance(chunk.text);
    utterance.rate = rateRef.current;
    utterance.volume = isMutedRef.current ? 0 : volumeRef.current;
    utterance.pitch = 1.05;

    const currentVoices = availableVoicesRef.current.length > 0
      ? availableVoicesRef.current
      : window.speechSynthesis.getVoices();

    const chosenVoice = currentVoices.find(v => v.name === selectedVoiceName)
      || currentVoices.find(v => v.lang.startsWith("en") && (v.name.includes("Jenny") || v.name.includes("Aria") || v.name.includes("Google") || v.name.includes("Zira")))
      || currentVoices.find(v => v.lang.startsWith("en"))
      || currentVoices[0];

    if (chosenVoice) {
      utterance.voice = chosenVoice;
    }

    utterance.onstart = () => {
      lastBoundaryTimeRef.current = Date.now();
      setSpokenCharIndex(chunk.startChar);
      const match = fullText.slice(chunk.startChar).match(/^\S+/);
      setSpokenCharLength(match ? match[0].length : 4);
    };

    // Accepts all boundaries and maps event index back to exact global text coordinates
    utterance.onboundary = (event: SpeechSynthesisEvent) => {
      lastBoundaryTimeRef.current = Date.now();
      const localCharIdx = (typeof event.charIndex === "number" && event.charIndex >= 0) ? event.charIndex : 0;
      const globalIdx = Math.min(fullText.length - 1, chunk.startChar + localCharIdx);
      setSpokenCharIndex(globalIdx);
      const match = fullText.slice(globalIdx).match(/^\S+/);
      setSpokenCharLength(event.charLength || (match ? match[0].length : 4));
    };

    utterance.onend = () => {
      if (!isCancelledRef.current && isSpeakingRef.current) {
        playChunk(index + 1);
      }
    };

    utterance.onerror = (e) => {
      if (e.error === "canceled" || e.error === "interrupted") return;
      if (!isCancelledRef.current && isSpeakingRef.current && index + 1 < chunks.length) {
        playChunk(index + 1);
      } else {
        stop();
      }
    };

    activeUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [selectedVoiceName, stop]);

  const resume = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      isPausedRef.current = false;
      setIsPaused(false);
    } else if (isPausedRef.current) {
      isPausedRef.current = false;
      setIsPaused(false);
      playChunk(chunkIndexRef.current);
    }
  }, [playChunk]);

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (clamped === 0) {
      setIsMuted(true);
    } else {
      setIsMuted(false);
      prevVolumeRef.current = clamped;
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("weaver_voice_volume", String(clamped));
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (!next && volume === 0) {
        setVolumeState(prevVolumeRef.current || 0.8);
      }
      return next;
    });
  }, [volume]);

  const cycleVolume = useCallback(() => {
    if (isMuted || volume === 0) {
      setIsMuted(false);
      setVolume(0.33);
    } else if (volume <= 0.45) {
      setIsMuted(false);
      setVolume(0.66);
    } else if (volume <= 0.8) {
      setIsMuted(false);
      setVolume(1.0);
    } else {
      setIsMuted(true);
      setVolume(0);
    }
  }, [isMuted, volume, setVolume]);

  const speak = useCallback((text: string, id: string = "default") => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    // Toggle pause/resume if clicking the same item
    if (currentIdRef.current === id && isSpeakingRef.current) {
      if (isPausedRef.current) {
        resume();
      } else {
        pause();
      }
      return;
    }

    stop();

    if (!text || !text.trim()) return;

    const chunks = chunkTextForSpeech(text);
    if (chunks.length === 0) return;

    chunksRef.current = chunks;
    chunkIndexRef.current = 0;
    currentTextRef.current = text;
    currentIdRef.current = id;
    isSpeakingRef.current = true;
    isPausedRef.current = false;
    isCancelledRef.current = false;

    setIsSpeaking(true);
    setIsPaused(false);
    setCurrentId(id);
    setSpokenCharIndex(chunks[0].startChar);
    const initialWord = text.slice(chunks[0].startChar).match(/^\S+/);
    setSpokenCharLength(initialWord ? initialWord[0].length : 4);

    playChunk(0);
  }, [stop, resume, pause, playChunk]);

  // Heartbeat ticker: advances word-by-word if browser voice doesn't fire onboundary
  // and keeps Chromium alive every 9s to prevent speech cutoff on long texts
  useEffect(() => {
    if (!isSpeaking || isPaused) return;

    let lastKeepAlive = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();

      // Chromium 15s keepalive pulse
      if (now - lastKeepAlive > 9000) {
        lastKeepAlive = now;
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
        }
      }

      // Word tracking fallback: if onboundary hasn't fired in > 320ms
      const timeSinceBoundary = now - lastBoundaryTimeRef.current;
      const msPerWord = 320 / (rate || 1.0);
      if (timeSinceBoundary >= msPerWord) {
        lastBoundaryTimeRef.current = now;
        const fullText = currentTextRef.current;
        setSpokenCharIndex(prev => {
          if (prev < 0 || prev >= fullText.length) return prev;
          const slice = fullText.slice(prev);
          const spaceMatch = slice.match(/\s+\S/);
          if (spaceMatch && spaceMatch.index !== undefined) {
            const nextIdx = prev + spaceMatch.index + (spaceMatch[0].length - 1);
            const nextWord = fullText.slice(nextIdx).match(/^\S+/);
            setSpokenCharLength(nextWord ? nextWord[0].length : 4);
            return nextIdx;
          }
          return prev;
        });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isSpeaking, isPaused, rate]);

  const cycleRate = useCallback(() => {
    const rates = [0.8, 1.0, 1.2, 1.5];
    const currentIndex = rates.indexOf(rate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setRateState(nextRate);
  }, [rate]);

  const setRate = useCallback((newRate: number) => {
    setRateState(newRate);
    if (isSpeakingRef.current && currentIdRef.current) {
      const wasPaused = isPausedRef.current;
      const id = currentIdRef.current;
      const fullText = currentTextRef.current;
      const resumeIndex = chunkIndexRef.current;
      stop();
      if (!wasPaused && id && fullText) {
        speak(fullText, id);
        if (resumeIndex > 0) {
          playChunk(resumeIndex);
        }
      }
    }
  }, [stop, speak, playChunk]);

  const startDictation = useCallback((onResult: (text: string) => void) => {
    if (typeof window === "undefined") return;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Voice speech recognition is not supported in this browser. Please try Chrome, Edge, or Safari.");
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      const recognition = new SpeechRec();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript) {
          onResult(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  }, []);

  const stopDictation = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsListening(false);
    }
  }, []);

  return {
    isSpeaking,
    isPaused,
    currentId,
    rate,
    volume,
    isMuted,
    spokenCharIndex,
    spokenCharLength,
    isListening,
    ttsSupported,
    sttSupported,
    voiceOptions,
    selectedVoiceName,
    setSelectedVoiceName,
    speak,
    pause,
    resume,
    stop,
    setRate,
    cycleRate,
    setVolume,
    cycleVolume,
    toggleMute,
    startDictation,
    stopDictation,
  };
}
