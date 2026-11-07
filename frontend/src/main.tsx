import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.tsx'
import { hasNativeTabs, isNative, syncNativeTheme } from './native'

if (isNative) document.documentElement.classList.add('native');
// The iPhone app's own tab bar, at every width (iPad too): pages keep room for it.
if (hasNativeTabs) document.documentElement.classList.add('native-tabs');
syncNativeTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
