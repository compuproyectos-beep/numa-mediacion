'use client';

import { useEffect, useState } from 'react';

// Las 3 versiones del logo que mandó el abogado, alternándose solas. Se usa
// tanto en el navbar como en el pie de página, en los mismos lugares donde
// antes iba el logo fijo.
const LOGOS = [
  '/logo-numa.png',
  '/images/logo-numa-oscuro.jpg',
  '/images/logo-numa-claro.jpg',
];

export default function RotatingLogo({
  className = 'h-14 w-44',
  intervalMs = 3200,
}: {
  className?: string;
  intervalMs?: number;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const intervalo = setInterval(() => {
      setIndex((i) => (i + 1) % LOGOS.length);
    }, intervalMs);

    return () => clearInterval(intervalo);
  }, [intervalMs]);

  return (
    <span className={`relative inline-block overflow-hidden rounded-sm ${className}`}>
      {LOGOS.map((src, i) => (
        <img
          key={src}
          src={src}
          alt="Centro de Mediación NUMA"
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 ${
            i === index ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </span>
  );
}
