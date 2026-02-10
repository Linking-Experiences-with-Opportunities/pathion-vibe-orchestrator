import React from 'react';

interface VariableInspectorProps {
    variables: Record<string, any>;
}

export const VariableInspector: React.FC<VariableInspectorProps> = ({ variables }) => {
    return (
        <div className="p-4 bg-zinc-900/30 border-b border-zinc-800 flex-1 overflow-y-auto">
            <div className="text-[10px] text-zinc-500 mb-3 uppercase font-black tracking-widest">Variables</div>
            <div className="flex flex-col gap-2">
                {variables && Object.entries(variables).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-xs font-mono group hover:bg-zinc-800/50 p-1 rounded transition-colors">
                        <span className="text-purple-400 font-semibold">{key}</span>
                        <span className="text-zinc-400 truncate max-w-[150px]" title={String(value)}>
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                    </div>
                ))}
                {(!variables || Object.keys(variables).length === 0) && (
                    <div className="text-zinc-600 italic text-xs text-center py-4">No variables in scope</div>
                )}
            </div>
        </div>
    );
};
