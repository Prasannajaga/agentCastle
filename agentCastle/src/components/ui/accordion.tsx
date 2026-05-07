import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

type AccordionContextType = {
  openItems: Set<string>
  toggle: (value: string) => void
  type: "single" | "multiple"
}

const AccordionContext = React.createContext<AccordionContextType>({
  openItems: new Set(),
  toggle: () => null,
  type: "single",
})

type AccordionProps = React.ComponentProps<"div"> & {
  type?: "single" | "multiple"
  defaultValue?: string | string[]
}

function Accordion({
  className,
  type = "single",
  defaultValue,
  ...props
}: AccordionProps) {
  const [openItems, setOpenItems] = React.useState<Set<string>>(() => {
    if (!defaultValue) return new Set()
    return new Set(Array.isArray(defaultValue) ? defaultValue : [defaultValue])
  })

  const toggle = React.useCallback(
    (value: string) => {
      setOpenItems((prev) => {
        const next = new Set(prev)
        if (next.has(value)) {
          next.delete(value)
        } else {
          if (type === "single") next.clear()
          next.add(value)
        }
        return next
      })
    },
    [type]
  )

  return (
    <AccordionContext.Provider value={{ openItems, toggle, type }}>
      <div
        data-slot="accordion"
        className={cn("divide-y divide-border/20", className)}
        {...props}
      />
    </AccordionContext.Provider>
  )
}

type AccordionItemContextType = {
  value: string
  isOpen: boolean
}

const AccordionItemContext = React.createContext<AccordionItemContextType>({
  value: "",
  isOpen: false,
})

function AccordionItem({
  className,
  value,
  ...props
}: React.ComponentProps<"div"> & { value: string }) {
  const { openItems } = React.useContext(AccordionContext)
  const isOpen = openItems.has(value)

  return (
    <AccordionItemContext.Provider value={{ value, isOpen }}>
      <div
        data-slot="accordion-item"
        data-state={isOpen ? "open" : "closed"}
        className={cn("", className)}
        {...props}
      />
    </AccordionItemContext.Provider>
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { toggle } = React.useContext(AccordionContext)
  const { value, isOpen } = React.useContext(AccordionItemContext)

  return (
    <button
      type="button"
      data-slot="accordion-trigger"
      data-state={isOpen ? "open" : "closed"}
      className={cn(
        "flex w-full items-center gap-2 py-3 text-sm font-medium transition-all hover:underline-offset-4 [&[data-state=open]>svg.accordion-chevron]:rotate-90",
        className
      )}
      onClick={() => toggle(value)}
      {...props}
    >
      <ChevronRight className="accordion-chevron h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-200" />
      {children}
    </button>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { isOpen } = React.useContext(AccordionItemContext)

  if (!isOpen) return null

  return (
    <div
      data-slot="accordion-content"
      className={cn(
        "overflow-hidden text-sm animate-in fade-in-0 slide-in-from-top-1 duration-200",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
