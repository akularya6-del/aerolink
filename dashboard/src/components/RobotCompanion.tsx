"use client";

import Spline from '@splinetool/react-spline';

export default function RobotCompanion() {
  return (
    <div className="fixed bottom-6 right-6 z-50 pointer-events-auto hover:scale-105 transition-transform duration-300">
      <div className="w-40 h-40 rounded-full overflow-hidden border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)] bg-black relative cursor-pointer ring-2 ring-transparent hover:ring-primary/20 transition-all">
        {/* Inner shadow to give the circle a sleek 3D embedded look and hide hard edges */}
        <div className="absolute inset-0 z-10 pointer-events-none shadow-[inset_0_0_20px_rgba(0,0,0,0.9)] rounded-full" />
        
        {/* Scale the canvas slightly so the robot fits perfectly in the circle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[115%] h-[115%]">
          <Spline scene="/ai_companion_robot.spline" />
        </div>
      </div>
    </div>
  );
}
