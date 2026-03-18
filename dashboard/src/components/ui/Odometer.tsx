import { useState, useEffect, useRef } from 'react'
import { clsx } from 'clsx'

interface OdometerProps {
  value: number
  prefix?: string
  decimals?: number
  className?: string
}

export function Odometer({ value, prefix = '', decimals = 2, className }: OdometerProps) {
  const [displayValue, setDisplayValue] = useState(value)
  const prevValueRef = useRef(value)
  const [isGlitching, setIsGlitching] = useState(false)

  useEffect(() => {
    if (value !== prevValueRef.current) {
      setIsGlitching(true)
      const duration = 800
      const steps = 20
      const stepValue = (value - prevValueRef.current) / steps
      let currentStep = 0

      const timer = setInterval(() => {
        currentStep++
        setDisplayValue(prev => prev + stepValue)
        if (currentStep >= steps) {
          clearInterval(timer)
          setDisplayValue(value)
          setIsGlitching(false)
        }
      }, duration / steps)

      prevValueRef.current = value
      return () => clearInterval(timer)
    }
  }, [value])

  return (
    <span className={clsx(
      "font-mono tabular-nums transition-colors duration-300",
      isGlitching ? "text-[#00D4FF]" : "text-white",
      className
    )}>
      {prefix}{displayValue.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      })}
    </span>
  )
}
