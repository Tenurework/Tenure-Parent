"use client"

import {
  Tabs as AriaTabs,
  TabList,
  Tab,
  TabPanel,
  type TabsProps,
  type TabProps,
  type TabPanelProps,
} from "react-aria-components"

export function Tabs({ children, ...props }: TabsProps) {
  return (
    <AriaTabs {...props} className="flex flex-col">
      {children}
    </AriaTabs>
  )
}

export function TabNav({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <TabList className={`flex border-b border-border gap-0 ${className ?? ""}`}>
      {children}
    </TabList>
  )
}

export function TabItem({ children, ...props }: TabProps) {
  return (
    <Tab
      {...props}
      className={`
        relative px-4 h-12 text-[15px] font-medium text-text-2 cursor-default
        outline-none transition-colors
        data-[selected]:text-[--primary]
        data-[hovered]:text-text-1
        data-[selected]:after:absolute data-[selected]:after:bottom-0 data-[selected]:after:left-0
        data-[selected]:after:right-0 data-[selected]:after:h-[2.5px] data-[selected]:after:rounded-full data-[selected]:after:bg-[--primary]
        data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--primary] data-[focus-visible]:ring-inset
      `}
    >
      {children}
    </Tab>
  )
}

export function TabContent({ children, ...props }: TabPanelProps) {
  return (
    <TabPanel {...props} className="outline-none pt-5">
      {children}
    </TabPanel>
  )
}
