import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Story Builder · Synthetic foundation",description:"Local foundation for approved, versioned multi-agent story workflows."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
