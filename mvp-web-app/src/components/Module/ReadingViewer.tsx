import React from 'react';

const ReadingViewer: React.FC = () => {
  return (
    <div className="max-w-2xl mx-auto py-4">
      <div className="space-y-6 text-zinc-300 leading-relaxed text-lg">
        {/* Drop Cap Intro */}
        <p className="first-letter:text-5xl first-letter:font-bold first-letter:text-blue-500 first-letter:mr-3 first-letter:float-left">
          Arrays are the most fundamental building blocks in computer science. At their core, an array is a contiguous block of memory where each element is stored at a fixed distance from the starting address.
        </p>

        <h2 className="text-2xl font-bold text-white mt-8 mb-4">Why Contiguous Memory?</h2>
        
        <p>
          Because arrays are contiguous, we can achieve <strong>O(1) access time</strong>. To find the address of the element at index <code>i</code>, the CPU simply calculates: 
          
          {/* Code Snippet */}
          <code className="block mt-4 p-4 bg-zinc-950 rounded-lg border border-zinc-800 text-blue-400 text-sm">
            Address = StartAddress + (i * ElementSize)
          </code>
        </p>
        
        <p>
          This simple arithmetic is why arrays are blisteringly fast for read operations, but slow for insertions (where elements might need to be shifted).
        </p>

        {/* Callout Box */}
        <div className="bg-blue-500/5 border border-blue-500/20 p-6 rounded-2xl mt-8">
            <h3 className="text-blue-400 font-bold mb-2">Key Takeaway</h3>
            <p className="text-sm">Random access is the superpower of arrays. If you know the index, you know the value instantly.</p>
        </div>
      </div>
    </div>
  );
};

export default ReadingViewer;