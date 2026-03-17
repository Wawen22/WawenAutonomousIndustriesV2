import { AgentList } from './components/AgentList.js'
import { TaskBoard } from './components/TaskBoard.js'
import { EventTimeline } from './components/EventTimeline.js'
import { CostPanel } from './components/CostPanel.js'
import { Header } from './components/Header.js'

export function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Header />

      <main className="container mx-auto px-6 py-6 max-w-screen-2xl">
        {/* Top row: Agent list + Task board */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          <div className="lg:col-span-1 bg-gray-900 rounded-xl p-5 border border-gray-700">
            <AgentList />
          </div>
          <div className="lg:col-span-3 bg-gray-900 rounded-xl p-5 border border-gray-700">
            <TaskBoard />
          </div>
        </div>

        {/* Bottom row: Timeline + Costs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-700">
            <EventTimeline />
          </div>
          <div className="bg-gray-900 rounded-xl p-5 border border-gray-700">
            <CostPanel />
          </div>
        </div>
      </main>
    </div>
  )
}
