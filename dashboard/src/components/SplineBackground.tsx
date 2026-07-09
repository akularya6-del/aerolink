"use client";

import Spline from '@splinetool/react-spline';

export default function SplineBackground() {
  return (
    <div className="fixed inset-0 w-full h-full z-0 pointer-events-none">
      <Spline scene="/animated_gradient_background_for_web.spline" />
    </div>
  );
}
