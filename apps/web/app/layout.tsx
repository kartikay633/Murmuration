import type { Metadata, Viewport } from 'next'
import { Instrument_Sans, JetBrains_Mono, Newsreader } from 'next/font/google'
import './globals.css'

const serif = Newsreader({
  subsets: ['latin'],
  axes: ['opsz'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
})
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Murmuration', template: '%s · Murmuration' },
  description: 'A shared workspace where many people write the same page at once.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F4EE' },
    { media: '(prefers-color-scheme: dark)', color: '#1A1916' },
  ],
}

// Set the theme before first paint so there's no light flash in dark mode.
const themeScript = `(function(){try{var t=localStorage.getItem('mm-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`

// Development only. Some browser extensions stamp their own attributes onto every
// element before React starts (bis_skin_checked, bis_register…), which React
// reports as a hydration mismatch and the dev overlay shows as an error. Drop
// exactly those reports, and nothing else. The filter wraps whatever later
// replaces console.error (the dev overlay does), so it stays in front; when that
// wrapper calls back into the filter, the call goes straight to the browser.
const extensionNoiseFilter = `(function(){try{
var marks=['bis_skin_checked','bis_register','bis_use','__processed_','chrome-extension://'];
function noise(args){var s='';for(var i=0;i<args.length;i++){try{s+=' '+String(args[i])}catch(e){}}
if(!/hydrat|didn.t match/i.test(s))return false;for(var j=0;j<marks.length;j++)if(s.indexOf(marks[j])>=0)return true;return false}
var native=console.error,inner=native,busy=false;
function guard(){if(noise(arguments))return;
if(busy||inner===guard)return native.apply(console,arguments);
busy=true;try{return inner.apply(console,arguments)}finally{busy=false}}
Object.defineProperty(console,'error',{configurable:true,get:function(){return guard},set:function(fn){inner=fn}});
}catch(e){}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === 'development' && <script dangerouslySetInnerHTML={{ __html: extensionNoiseFilter }} />}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
