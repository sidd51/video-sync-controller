import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import ControllerPage from "./pages/ControllerPage";
import DisplayPage from "./pages/DisplayPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/controller" element={<ControllerPage />} />
      <Route path="/display/:displayId" element={<DisplayPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
