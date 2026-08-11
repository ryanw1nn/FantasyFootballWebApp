import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function StatsCard({ title, value, subtitle, icon: Icon, trend }) {
    return (
        <div className="bg-white rounded-lg shadow-sm p-4 border border-slate-200">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-sm text-slate-600 font-medium">{title}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
                    {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
                </div>
                {Icon && (
                    <div className="bg-accent-50 rounded-full p-2">
                        <Icon className="w-5 h-5 text-accent-600"/>
                    </div>
                )}
            </div>
            {trend && (
                <div className={`flex items-center mt-2 text-sm ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {trend > 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                    <span>{Math.abs(trend)}% from last season</span>
                </div>
            )}
        </div>
    );
}