import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { PolicyCopilot } from "@/components/copilot/PolicyCopilot";
import { AuthProvider } from "@/hooks/useAuth";
import Dashboard from "./pages/Dashboard";
import Events from "./pages/Events";
import EventDetail from "./pages/EventDetail";
import Speakers from "./pages/Speakers";
import MeetingCycles from "./pages/MeetingCycles";
import Predictions from "./pages/Predictions";
import EmpiricalPolicy from "./pages/EmpiricalPolicy";
import StatisticalData from "./pages/StatisticalData";
import Communications from "./pages/Communications";
import Committee from "./pages/Committee";
import TopicHeatmaps from "./pages/TopicHeatmaps";
import PolicyTaxonomy from "./pages/PolicyTaxonomy";
import PolicyRadar from "./pages/PolicyRadar";
import SettingsPage from "./pages/SettingsPage";
import Alerts from "./pages/Alerts";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NotFound from "./pages/NotFound";
import SettingsPage from "./pages/SettingsPage";
const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="*" element={
              <AppLayout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/events" element={<Events />} />
                  <Route path="/events/:eventId" element={<EventDetail />} />
                  <Route path="/speakers" element={<Speakers />} />
                  <Route path="/meetings" element={<MeetingCycles />} />
                  <Route path="/stats" element={<StatisticalData />} />
                  <Route path="/comms" element={<Communications />} />
                  <Route path="/predictions" element={<Predictions />} />
                  <Route path="/empirical" element={<EmpiricalPolicy />} />
                  <Route path="/committee" element={<Committee />} />
                  <Route path="/topics" element={<TopicHeatmaps />} />
                  <Route path="/taxonomy" element={<PolicyTaxonomy />} />
                  <Route path="/radar" element={<PolicyRadar />} />
                  <Route path="/alerts" element={<Alerts />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </AppLayout>
            } />
          </Routes>
          <PolicyCopilot />
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
