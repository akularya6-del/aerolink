"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function RadarWidget({ logCount }: { logCount: number }) {
  const [pulses, setPulses] = useState<{ id: number; x: number; y: number }[]>([]);

  useEffect(() => {
    if (logCount === 0) return;
    
    // Create a new pulse at a random position within the inner circle
    const newPulse = {
      id: Date.now(),
      x: 30 + Math.random() * 40, // 30% to 70% width
      y: 30 + Math.random() * 40, // 30% to 70% height
    };
    
    setPulses((p) => [...p, newPulse]);

    // Remove pulse after animation completes
    const timer = setTimeout(() => {
      setPulses((p) => p.filter((pulse) => pulse.id !== newPulse.id));
    }, 1500);

    return () => clearTimeout(timer);
  }, [logCount]);

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      {/* Radar Background Rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
        <div className="absolute w-[90%] h-[90%] rounded-full border border-primary/50" />
        <div className="absolute w-[60%] h-[60%] rounded-full border border-primary/50" />
        <div className="absolute w-[30%] h-[30%] rounded-full border border-primary/50 bg-primary/10" />
        <div className="absolute w-full h-[1px] bg-primary/30" />
        <div className="absolute h-full w-[1px] bg-primary/30" />
      </div>

      {/* Sweeping Radar Line */}
      <motion.div
        className="absolute w-1/2 h-[1px] bg-gradient-to-r from-transparent to-primary origin-left top-1/2 left-1/2 pointer-events-none opacity-50 z-10"
        animate={{ rotate: 360 }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
      />

      {/* Pulses */}
      <AnimatePresence>
        {pulses.map((pulse) => (
          <motion.div
            key={pulse.id}
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 3, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: "easeOut" }}
            className="absolute w-4 h-4 rounded-full bg-primary z-20"
            style={{ left: `${pulse.x}%`, top: `${pulse.y}%`, transform: 'translate(-50%, -50%)' }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
