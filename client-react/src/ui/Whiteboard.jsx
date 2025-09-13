import React, { useState, useRef, useEffect, useCallback } from 'react';

export default function Whiteboard({ username, selected, socket, onBack }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState('pen');
  const [brushSize, setBrushSize] = useState(2);
  const [currentColor, setCurrentColor] = useState('#2ea043');
  const [strokes, setStrokes] = useState([]);
  const [currentStroke, setCurrentStroke] = useState([]);
  const lastPointRef = useRef(null);

  const colors = [
    '#2ea043', '#1f6feb', '#da3633', '#f85149', 
    '#fd7e14', '#d1242f', '#8b5cf6', '#ec4899',
    '#06b6d4', '#10b981', '#f59e0b', '#6b7280',
    '#000000', '#ffffff'
  ];

  // Initialize whiteboard and load history
  useEffect(() => {
    if (socket && selected) {
      socket.emit('join_whiteboard', { withUser: selected });
      
      // Load from localStorage as fallback
      const localKey = `whiteboard-${[username, selected].sort().join('-')}`;
      const localData = localStorage.getItem(localKey);
      if (localData) {
        try {
          const parsed = JSON.parse(localData);
          setStrokes(parsed.strokes || []);
          redrawCanvas(parsed.strokes || []);
        } catch (e) {
          console.warn('Failed to load local whiteboard data');
        }
      }
      
      // Listen for whiteboard events
      const handleWhiteboardHistory = ({ strokes: historyStrokes }) => {
        setStrokes(historyStrokes || []);
        redrawCanvas(historyStrokes || []);
        
        // Save to localStorage
        try {
          localStorage.setItem(localKey, JSON.stringify({ strokes: historyStrokes || [] }));
        } catch (e) {
          console.warn('Failed to save whiteboard to localStorage');
        }
      };

      const handleStrokeDrawn = ({ stroke }) => {
        setStrokes(prev => {
          const newStrokes = [...prev, stroke];
          redrawCanvas(newStrokes);
          
          // Save to localStorage
          try {
            localStorage.setItem(localKey, JSON.stringify({ strokes: newStrokes }));
          } catch (e) {
            console.warn('Failed to save whiteboard to localStorage');
          }
          
          return newStrokes;
        });
      };

      const handleWhiteboardCleared = () => {
        setStrokes([]);
        clearCanvas();
        
        // Clear localStorage
        try {
          localStorage.removeItem(localKey);
        } catch (e) {
          console.warn('Failed to clear localStorage');
        }
      };

      socket.on('whiteboard_history', handleWhiteboardHistory);
      socket.on('stroke_drawn', handleStrokeDrawn);
      socket.on('whiteboard_cleared', handleWhiteboardCleared);

      return () => {
        socket.off('whiteboard_history', handleWhiteboardHistory);
        socket.off('stroke_drawn', handleStrokeDrawn);
        socket.off('whiteboard_cleared', handleWhiteboardCleared);
        socket.emit('leave_whiteboard', { withUser: selected });
      };
    }
  }, [socket, selected, username]);

  // Setup canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Redraw existing strokes
      redrawCanvas(strokes);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [strokes]);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const redrawCanvas = useCallback((strokesArray) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    strokesArray.forEach(stroke => {
      if (stroke.points && stroke.points.length > 1) {
        ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
        ctx.strokeStyle = stroke.color || '#000000';
        ctx.lineWidth = stroke.size || 2;
        
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        
        ctx.stroke();
      }
    });
  }, []);

  const getMousePos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const getTouchPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.touches[0].clientX - rect.left,
      y: e.touches[0].clientY - rect.top
    };
  };

  const startDrawing = (pos) => {
    setIsDrawing(true);
    setCurrentStroke([pos]);
    lastPointRef.current = pos;
  };

  const draw = (pos) => {
    if (!isDrawing || !lastPointRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    ctx.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    
    // Add point to current stroke
    setCurrentStroke(prev => [...prev, pos]);
    lastPointRef.current = pos;
  };

  const endDrawing = () => {
    if (!isDrawing || currentStroke.length === 0) return;
    setIsDrawing(false);
    
    // Create the final stroke object
    const finalStroke = {
      points: currentStroke,
      color: currentColor,
      size: brushSize,
      tool: currentTool
    };
    
    // Add to local strokes and save to localStorage
    setStrokes(prev => {
      const newStrokes = [...prev, finalStroke];
      
      // Save to localStorage
      try {
        const localKey = `whiteboard-${[username, selected].sort().join('-')}`;
        localStorage.setItem(localKey, JSON.stringify({ strokes: newStrokes }));
      } catch (e) {
        console.warn('Failed to save whiteboard to localStorage');
      }
      
      return newStrokes;
    });
    
    // Send stroke to server
    if (socket && selected) {
      socket.emit('draw_stroke', {
        withUser: selected,
        stroke: finalStroke
      });
    }
    
    // Reset current stroke
    setCurrentStroke([]);
    lastPointRef.current = null;
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    startDrawing(getMousePos(e));
  };

  const handleMouseMove = (e) => {
    e.preventDefault();
    if (isDrawing) {
      draw(getMousePos(e));
    }
  };

  const handleMouseUp = (e) => {
    e.preventDefault();
    endDrawing();
  };

  const handleTouchStart = (e) => {
    e.preventDefault();
    startDrawing(getTouchPos(e));
  };

  const handleTouchMove = (e) => {
    e.preventDefault();
    if (isDrawing) {
      draw(getTouchPos(e));
    }
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    endDrawing();
  };

  const handleClearWhiteboard = () => {
    if (socket && selected) {
      socket.emit('clear_whiteboard', { withUser: selected });
    }
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: '#0d1117',
      position: 'relative'
    }}>
      {/* Header */}
      <div style={{
        padding: 20,
        borderBottom: '1px solid rgba(33, 38, 45, 0.8)',
        background: 'linear-gradient(135deg, rgba(22, 27, 34, 0.95) 0%, rgba(28, 33, 40, 0.95) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={onBack}
            style={{
              background: 'rgba(48, 54, 61, 0.6)',
              border: '1px solid rgba(48, 54, 61, 0.8)',
              borderRadius: 8,
              color: '#e6edf3',
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={e => {
              e.target.style.background = 'rgba(88, 166, 255, 0.2)';
              e.target.style.borderColor = 'rgba(88, 166, 255, 0.4)';
            }}
            onMouseLeave={e => {
              e.target.style.background = 'rgba(48, 54, 61, 0.6)';
              e.target.style.borderColor = 'rgba(48, 54, 61, 0.8)';
            }}
          >
            ← Back to Chat
          </button>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f0f6fc' }}>
            Whiteboard with {selected}
          </div>
        </div>
        
        <button
          onClick={handleClearWhiteboard}
          style={{
            background: 'linear-gradient(135deg, #fd7e14 0%, #f59e0b 100%)',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            padding: '10px 20px',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            transition: 'all 0.2s ease',
            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
          onMouseEnter={e => {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.4)';
          }}
          onMouseLeave={e => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.boxShadow = '0 2px 8px rgba(245, 158, 11, 0.3)';
          }}
        >
          <span style={{ fontSize: 16 }}>🗑️</span>
          Clear Canvas
        </button>
      </div>

      {/* Tools */}
      <div style={{
        padding: 16,
        borderBottom: '1px solid rgba(33, 38, 45, 0.8)',
        background: 'rgba(22, 27, 34, 0.8)',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap'
      }}>
        {/* Tool Selection */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setCurrentTool('pen')}
            style={{
              padding: '8px 12px',
              background: currentTool === 'pen' ? 'linear-gradient(135deg, #238636 0%, #2ea043 100%)' : 'rgba(48, 54, 61, 0.6)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            Pen
          </button>
          <button
            onClick={() => setCurrentTool('eraser')}
            style={{
              padding: '8px 12px',
              background: currentTool === 'eraser' ? 'linear-gradient(135deg, #da3633 0%, #f85149 100%)' : 'rgba(48, 54, 61, 0.6)',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
          >
            Eraser
          </button>
        </div>

        {/* Brush Size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Size:</span>
          <input
            type="range"
            min="1"
            max="20"
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 600, minWidth: 20 }}>{brushSize}</span>
        </div>

        {/* Color Palette */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Color:</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {colors.map(color => (
              <button
                key={color}
                onClick={() => setCurrentColor(color)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: color,
                  border: currentColor === color ? '2px solid #58a6ff' : '2px solid rgba(48, 54, 61, 0.6)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: currentColor === color ? '0 0 8px rgba(88, 166, 255, 0.4)' : 'none'
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            width: '100%',
            height: '100%',
            background: '#ffffff',
            cursor: currentTool === 'pen' ? 'crosshair' : 'grab',
            touchAction: 'none'
          }}
        />
      </div>
    </div>
  );
}
