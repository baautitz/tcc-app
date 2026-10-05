import { AppProviders } from "./providers";
import { ProtectedApp } from "./routes";

function App() {
  return (
    <AppProviders>
      <ProtectedApp />
    </AppProviders>
  );
}

export default App;
