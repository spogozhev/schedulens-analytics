'use client'

import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { CalendarClock, Github, Layers, LayoutDashboard, Users, MapPin } from 'lucide-react'
import { FiltersBar } from './filters-bar'
import { ThemeToggle } from './theme-toggle'
import { OverviewTab } from './overview-tab'
import { TeachersTab } from './teachers-tab'
import { RoomsTab } from './rooms-tab'
import { TeacherDetailDialog } from './teacher-detail'
import { RoomDetailDialog } from './room-detail'

export function Dashboard() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        <FiltersBar />
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid grid-cols-3 w-full max-w-md h-10">
            <TabsTrigger value="overview" className="gap-2">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Обзор</span>
            </TabsTrigger>
            <TabsTrigger value="teachers" className="gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Преподаватели</span>
            </TabsTrigger>
            <TabsTrigger value="rooms" className="gap-2">
              <MapPin className="h-4 w-4" />
              <span className="hidden sm:inline">Аудитории</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="teachers" className="mt-4">
            <TeachersTab />
          </TabsContent>
          <TabsContent value="rooms" className="mt-4">
            <RoomsTab />
          </TabsContent>
        </Tabs>
      </main>
      <TeacherDetailDialog />
      <RoomDetailDialog />
      <Footer />
    </div>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500 text-white shrink-0">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-base sm:text-lg truncate">
              Аналитика расписания преподавателей
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Загруженность преподавателей и аудиторий · учёт одновременных занятий
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="hidden md:inline-flex bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900/50">
            <Layers className="h-3 w-3 mr-1" />
            одновременные занятия учитываются
          </Badge>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="mt-auto border-t bg-background">
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          Источник данных: timetable.spbu.ru · 2025/2026 уч. год
        </div>
        <a
          href="https://github.com/spogozhev/schedulens-analytics"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <Github className="h-3.5 w-3.5" />
          schedulens-analytics
        </a>
      </div>
    </footer>
  )
}
