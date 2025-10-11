import React from "react";

export default function Layout({ children }) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-200 text-gray-900">
            <header className="bg-indigo-600 text-white py-6 shadow-lg">
                <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                        The Fan Club
                    </h1>

                    {/* Future navigation */}
                    <nav className="hidden md:flex gap-6 text-sm font-medium">
                        <a href="#" className="hover:text-indigo-200">Home</a>
                        <a href="#" className="hover:text-indigo-200">Seasons</a>
                        <a href="#" className="hover:text-indigo-200">About</a>
                    </nav>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-10">
                {children}
            </main>

            <footer className="bg-gray-900 text-gray-400 py-6 mt-10">
                <div className="max-w-7xl mx-auto px-6 text-center text-sm">
                   <p>⚡ Built with React + Vite | Created by Ryan Winn</p>
                </div>
            </footer>
        </div>
    )
}