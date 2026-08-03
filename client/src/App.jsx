import { Navigate, Route, Routes} from "react-router-dom";
import ControllerPage from "./pages/ControllerPage";
import DisplayPage from "./pages/DisplayPage";

function App(){
  return(
    <Routes>
      <Route path="/controller" element={<ControllerPage />} />
      <Route path="/display" element={<DisplayPage />} />
      <Route path="*" element={<Navigate to="/controller" />} />
    </Routes>
  )
}
export default App;