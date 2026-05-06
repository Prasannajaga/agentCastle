import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/views/providers/ThemeProvider";
import { MainLayout } from "@/views/Layout/MainLayout";
import { AgentsView } from "@/views/Agents/AgentsView";
import { MetricsView } from "@/views/Metrics/MetricsView";
import { SettingsView } from "@/views/Settings/SettingsView";
import "./App.css";

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<AgentsView />} />
            <Route path="/metrics" element={<MetricsView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
