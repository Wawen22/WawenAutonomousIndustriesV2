import { useState } from 'react'
import { clsx } from 'clsx'

interface ExpandableTextProps {
  text: string
  className?: string
  maxLength?: number
  buttonColor?: string
}

export function ExpandableText({ 
  text, 
  className, 
  maxLength = 100,
  buttonColor = "text-[#00D4FF]/60 hover:text-[#00D4FF]"
}: ExpandableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isLong = text.length > maxLength

  return (
    <div className="relative">
      <p className={clsx(
        className,
        isLong && !isExpanded && "line-clamp-2",
        "transition-all duration-200"
      )}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
          className={clsx(
            "text-[9px] font-bold mt-1 uppercase tracking-widest flex items-center gap-1 transition-colors",
            buttonColor
          )}
        >
          {isExpanded ? (
            <>Collapse <span className="text-[12px] leading-none">↑</span></>
          ) : (
            <>Read More <span className="text-[12px] leading-none">↓</span></>
          )}
        </button>
      )}
    </div>
  )
}
