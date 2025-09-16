import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, query, serverTimestamp, getDocs } from 'firebase/firestore';

// Main App component
const App = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [documentContext, setDocumentContext] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [starState, setStarState] = useState(0); // 0: Start, 1: Situation, 2: Task, 3: Action, 4: Result, 5: Done
  const [starAnswer, setStarAnswer] = useState({ question: '', situation: '', task: '', action: '', result: '' });
  const [finalStarAnswer, setFinalStarAnswer] = useState('');
  const [selectedPersona, setSelectedPersona] = useState('formal');
  const [savedInterviews, setSavedInterviews] = useState([]);
  const [savedStarAnswers, setSavedStarAnswers] = useState([]);
  const [selectedInterviewId, setSelectedInterviewId] = useState(null);
  const [selectedStarId, setSelectedStarId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [realTimeTip, setRealTimeTip] = useState(null);
  const chatEndRef = useRef(null);

  // Firebase
  const firebaseApp = useRef(null);
  const firestoreDb = useRef(null);
  const firestoreAuth = useRef(null);
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  
  // NOTE FOR LOCAL DEVELOPMENT: When you move this code to your local project,
  // you will replace the line below with:
  // const firebaseConfig = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG || '{}');
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

  // API Configuration
  // NOTE FOR LOCAL DEVELOPMENT: When you move this code to your local project,
  // you will replace the line below with:
  // const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
  const API_KEY = ""; // This is read from your .env.local file in your local project

  const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
  const TEXT_MODEL = 'gemini-2.5-flash-preview-05-20';
  const API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

  const personaVoices = {
    formal: "Rasalgethi",
    casual: "Umbriel",
    challenging: "Kore",
  };

  // Initialize Firebase and Auth
  useEffect(() => {
    try {
      // For local development, firebaseConfig will be populated by import.meta.env
      // For the Canvas environment, it's populated by __firebase_config
      if (!firebaseApp.current && Object.keys(firebaseConfig).length > 0) {
        firebaseApp.current = initializeApp(firebaseConfig);
        firestoreAuth.current = getAuth(firebaseApp.current);
        firestoreDb.current = getFirestore(firebaseApp.current);

        onAuthStateChanged(firestoreAuth.current, async (user) => {
          if (user) {
            setUserId(user.uid);
            console.log("Firebase initialized and user authenticated:", user.uid);
          } else {
            console.log("No user signed in, signing in anonymously...");
            try {
              if (typeof __initial_auth_token !== 'undefined') {
                await signInWithCustomToken(firestoreAuth.current, __initial_auth_token);
              } else {
                await signInAnonymously(firestoreAuth.current);
              }
            } catch (error) {
              console.error("Firebase Auth error:", error);
            }
          }
        });
      }
    } catch (e) {
      console.error("Firebase init failed:", e);
    }
  }, []);

  // Set up real-time listeners for interviews and STAR answers
  useEffect(() => {
    if (userId && firestoreDb.current) {
      const interviewCollectionRef = collection(firestoreDb.current, `artifacts/${appId}/users/${userId}/interview_data`);
      const starCollectionRef = collection(firestoreDb.current, `artifacts/${appId}/users/${userId}/star_answers`);
      
      const unsubscribeInterviews = onSnapshot(query(interviewCollectionRef), (snapshot) => {
        const interviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort in memory to avoid index issues
        interviews.sort((a, b) => b.timestamp?.seconds - a.timestamp?.seconds);
        setSavedInterviews(interviews);
      }, (error) => console.error("Error fetching interviews:", error));

      const unsubscribeStars = onSnapshot(query(starCollectionRef), (snapshot) => {
        const starAnswers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        starAnswers.sort((a, b) => b.timestamp?.seconds - a.timestamp?.seconds);
        setSavedStarAnswers(starAnswers);
      }, (error) => console.error("Error fetching STAR answers:", error));

      return () => {
        unsubscribeInterviews();
        unsubscribeStars();
      };
    }
  }, [userId, appId]);

  // Scroll to the end of the chat history
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory]);

  // Check for Web Speech API compatibility
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = false;
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      setSpeechRecognition(recognition);

      recognition.onstart = () => {
        setIsRecording(true);
        setUserInput('');
      };

      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0].transcript)
          .join('');
        setUserInput(transcript);
        setIsRecording(false);
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        setLoadingMessage('Speech recognition failed. Please try again.');
        setTimeout(() => setLoadingMessage(''), 3000);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };
    } else {
      console.warn('Web Speech API is not supported in this browser.');
    }
  }, []);

  const handleStartRecording = () => {
    if (speechRecognition) {
      speechRecognition.start();
    }
  };

  const handleStopRecording = () => {
    if (speechRecognition) {
      speechRecognition.stop();
    }
  };
  
  // Custom alert/modal for non-browser alerts
  const showMessage = (message, duration = 3000) => {
    setLoadingMessage(message);
    setTimeout(() => setLoadingMessage(''), duration);
  };

  // Generic Gemini API call with exponential backoff
  const callGeminiAPI = async (model, contents, config = {}, retries = 3, delay = 1000) => {
    try {
      const response = await fetch(`${API_BASE_URL}/${model}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          generationConfig: config
        }),
      });

      if (!response.ok) {
        if (response.status === 429 && retries > 0) {
          console.log(`Rate limit exceeded. Retrying in ${delay}ms...`);
          await new Promise(res => setTimeout(res, delay));
          return callGeminiAPI(model, contents, config, retries - 1, delay * 2);
        }
        throw new Error(`API call failed with status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('API call error:', error);
      throw error;
    }
  };

  // TTS function
  const speakText = async (text) => {
    setIsSpeaking(true);
    try {
      const payload = {
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModality: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: personaVoices[selectedPersona] }
            }
          }
        },
        model: TTS_MODEL
      };
      
      const response = await fetch(`${API_BASE_URL}/${TTS_MODEL}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      const part = result?.candidates?.[0]?.content?.parts?.[0];
      const audioData = part?.inlineData?.data;
      const mimeType = part?.inlineData?.mimeType;

      if (audioData && mimeType && mimeType.startsWith("audio/")) {
        const base64ToArrayBuffer = (base64) => {
          const binaryString = window.atob(base64);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return bytes.buffer;
        };

        const pcmToWav = (pcmData, sampleRate) => {
          const pcm16 = new Int16Array(pcmData);
          const buffer = new ArrayBuffer(44 + pcm16.length * 2);
          const view = new DataView(buffer);
          let offset = 0;

          const writeString = (str) => {
            for (let i = 0; i < str.length; i++) {
              view.setUint8(offset++, str.charCodeAt(i));
            }
          };

          const writeUint32 = (val) => {
            view.setUint32(offset, val, true);
            offset += 4;
          };

          const writeUint16 = (val) => {
            view.setUint16(offset, val, true);
            offset += 2;
          };

          writeString('RIFF');
          writeUint32(36 + pcm16.length * 2);
          writeString('WAVE');
          writeString('fmt ');
          writeUint32(16);
          writeUint16(1);
          writeUint16(1);
          writeUint32(sampleRate);
          writeUint32(sampleRate * 2);
          writeUint16(2);
          writeUint16(16);
          writeString('data');
          writeUint32(pcm16.length * 2);
          
          for (let i = 0; i < pcm16.length; i++) {
            view.setInt16(offset, pcm16[i], true);
            offset += 2;
          }
          
          return new Blob([view], { type: 'audio/wav' });
        };
        
        const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
        const pcmData = base64ToArrayBuffer(audioData);
        const wavBlob = pcmToWav(pcmData, sampleRate);
        const audioUrl = URL.createObjectURL(wavBlob);
        
        const audio = new Audio(audioUrl);
        audio.onended = () => setIsSpeaking(false);
        audio.play();

      } else {
        console.error("Failed to get audio data.");
        setIsSpeaking(false);
      }
    } catch (error) {
      console.error('TTS error:', error);
      setIsSpeaking(false);
    }
  };

  const getRealTimeTip = async (userAnswer, interviewHistory) => {
    const prompt = `Analyze the following interview answer from a candidate. Provide a very short, actionable tip for improvement. Focus on a single point like conciseness, clarity, relevance, or using the STAR method. Do not provide a long explanation.

    User's last answer: "${userAnswer}"

    Interview context so far:
    ${interviewHistory.map(m => `${m.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${m.text}`).join('\n')}

    Example tips:
    - Try to be more concise.
    - Provide a more specific example.
    - Elaborate on the "Action" you took.
    - Connect your answer back to the job requirements.
    `;

    try {
      const response = await callGeminiAPI(TEXT_MODEL, [{ role: 'user', parts: [{ text: prompt }] }]);
      const tipText = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (tipText) {
        setRealTimeTip(tipText);
        setTimeout(() => setRealTimeTip(null), 7000); // Clear tip after 7 seconds
      }
    } catch (error) {
      console.error('Error getting real-time tip:', error);
    }
  };

  // Logic for the mock interview
  const startMockInterview = async () => {
    setCurrentPage('mockInterview');
    setChatHistory([]);
    setLoadingMessage('Initializing mock interview...');
    setIsLoading(true);

    const interviewPrompt = `You are a professional FBI interviewer for the Unit Chief for Victim Services position. Your persona is **${selectedPersona}**. You are a structured, formal, and objective. You will ask one question at a time. Do not provide commentary or feedback. Your first question should be an introduction, such as "Thank you for coming in today. Can you start by telling me a little about your background and why you are interested in this position?".
    
    Job Description Context:
    ${documentContext || "No specific job description provided. Proceed with general questions for the role."}
    `;

    const initialContent = [{ role: 'user', parts: [{ text: interviewPrompt }] }];

    try {
      const response = await callGeminiAPI(TEXT_MODEL, initialContent);
      const firstQuestion = response.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (firstQuestion) {
        setChatHistory([{ role: 'interviewer', text: firstQuestion }]);
        speakText(firstQuestion);
      } else {
        showMessage('Failed to start the interview. Please try again.');
      }
    } catch (error) {
      console.error('Error starting interview:', error);
      showMessage('An error occurred. Please check the console.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const submitMockAnswer = async () => {
    if (!userInput.trim()) return;

    const currentAnswer = userInput;
    const newChatHistory = [...chatHistory, { role: 'user', text: currentAnswer }];
    setChatHistory(newChatHistory);
    setUserInput('');
    setLoadingMessage('Generating next question...');
    setIsLoading(true);
    getRealTimeTip(currentAnswer, newChatHistory);

    const interviewPrompt = `You are a professional FBI interviewer for the Unit Chief for Victim Services position. Your persona is **${selectedPersona}**. You are structured, formal, and objective. You ask one question at a time. Do not provide commentary or feedback.
    
    Here is the conversation so far:
    ${newChatHistory.map(m => `${m.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${m.text}`).join('\n')}
    
    Based on the conversation and the following job context, provide the next logical interview question.
    
    Job Description Context:
    ${documentContext || "No specific job description provided."}
    `;
    
    try {
      const response = await callGeminiAPI(TEXT_MODEL, [{ role: 'user', parts: [{ text: interviewPrompt }] }]);
      const nextQuestion = response.candidates?.[0]?.content?.parts?.[0]?.text;

      if (nextQuestion) {
        setChatHistory(prev => [...prev, { role: 'interviewer', text: nextQuestion }]);
        speakText(nextQuestion);
      } else {
        showMessage('Failed to get a new question. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting answer:', error);
      showMessage('An error occurred. Please check the console.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const getInterviewFeedback = async () => {
    setCurrentPage('feedback');
    setLoadingMessage('Analyzing your performance...');
    setIsLoading(true);

    const feedbackPrompt = `Analyze the following mock interview transcript for a candidate applying for the FBI Unit Chief for Victim Services position.
    
    Provide a detailed analysis in a JSON object with the following schema:
    {
      "score": number, // A score from 1-10, with 10 being the best.
      "strengths": string[], // Specific examples of strengths.
      "improvements": string[], // Areas for improvement.
      "ideal_answers": {
        [question: string]: string // Ideal answer for each question.
      }
    }

    Transcript:
    ${chatHistory.map(m => `${m.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${m.text}`).join('\n')}
    `;
    
    try {
      const response = await callGeminiAPI(TEXT_MODEL, [{ role: 'user', parts: [{ text: feedbackPrompt }] }], { responseMimeType: "application/json" });
      const feedbackJson = response.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsedFeedback = JSON.parse(feedbackJson);

      if (parsedFeedback) {
        setFeedback(parsedFeedback);
        
        // Save to Firestore
        if (userId && firestoreDb.current) {
          const docRef = doc(collection(firestoreDb.current, `artifacts/${appId}/users/${userId}/interview_data`));
          await setDoc(docRef, {
            transcript: chatHistory,
            feedback: parsedFeedback,
            timestamp: serverTimestamp(),
            documentContext: documentContext,
          });
          showMessage('Feedback saved successfully!');
        }
      } else {
        showMessage('Failed to generate feedback. Please try again.');
      }
    } catch (error) {
      console.error('Error getting feedback:', error);
      showMessage('An error occurred. Please check the console.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const viewSavedInterview = (interview) => {
    setSelectedInterviewId(interview.id);
    setChatHistory(interview.transcript);
    setFeedback(interview.feedback);
    setDocumentContext(interview.documentContext);
    setCurrentPage('feedback');
  };

  // Logic for STAR method assistant
  const startStarAssistant = () => {
    setCurrentPage('starMethod');
    setStarState(0);
    setStarAnswer({ question: '', situation: '', task: '', action: '', result: '' });
  };

  const handleStarPrompt = async (stage, prompt) => {
    setLoadingMessage(`Thinking about your ${stage}...`);
    setIsLoading(true);

    const starPrompt = `You are a STAR method assistant. Guide the user to structure their behavioral interview answer. The user has provided the following prompt:
    "${prompt}"
    
    Current stage: ${stage}
    
    Provide a simple, clear, and encouraging prompt to help the user articulate the next part of their answer based on the STAR method. For example, if the user has entered a situation, ask them to describe the task.`;

    try {
      const response = await callGeminiAPI(TEXT_MODEL, [{ role: 'user', parts: [{ text: starPrompt }] }]);
      const nextPrompt = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (nextPrompt) {
        showMessage(nextPrompt, 6000);
      }
    } catch (error) {
      console.error('Error getting STAR prompt:', error);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };
  
  const submitStarAnswer = async () => {
    if (!userInput.trim()) return;

    switch (starState) {
      case 0:
        setStarState(1);
        handleStarPrompt('Situation', userInput);
        setStarAnswer({ ...starAnswer, question: userInput });
        setUserInput('');
        break;
      case 1:
        setStarAnswer({ ...starAnswer, situation: userInput });
        setStarState(2);
        handleStarPrompt('Task', starAnswer.question);
        setUserInput('');
        break;
      case 2:
        setStarAnswer({ ...starAnswer, task: userInput });
        setStarState(3);
        handleStarPrompt('Action', starAnswer.question);
        setUserInput('');
        break;
      case 3:
        setStarAnswer({ ...starAnswer, action: userInput });
        setStarState(4);
        handleStarPrompt('Result', starAnswer.question);
        setUserInput('');
        break;
      case 4:
        const finalAnswerData = {
          question: starAnswer.question,
          situation: starAnswer.situation,
          task: starAnswer.task,
          action: starAnswer.action,
          result: userInput
        };
        const fullAnswer = `**S**ituation: ${finalAnswerData.situation}\n**T**ask: ${finalAnswerData.task}\n**A**ction: ${finalAnswerData.action}\n**R**esult: ${finalAnswerData.result}`;
        setFinalStarAnswer(fullAnswer);
        setStarState(5);
        setUserInput('');
        
        // Save to Firestore
        if (userId && firestoreDb.current) {
          const docRef = doc(collection(firestoreDb.current, `artifacts/${appId}/users/${userId}/star_answers`));
          await setDoc(docRef, {
            ...finalAnswerData,
            timestamp: serverTimestamp(),
          });
          showMessage('STAR answer saved successfully!');
        }
        break;
      default:
        break;
    }
  };

  const viewSavedStarAnswer = (starAnswer) => {
    setSelectedStarId(starAnswer.id);
    setStarAnswer(starAnswer);
    const fullAnswer = `**S**ituation: ${starAnswer.situation}\n**T**ask: ${starAnswer.task}\n**A**ction: ${starAnswer.action}\n**R**esult: ${starAnswer.result}`;
    setFinalStarAnswer(fullAnswer);
    setCurrentPage('starMethod');
    setStarState(5);
  };

  // Logic for Interview Question Generator
  const generateQuestions = async () => {
    setCurrentPage('questionGenerator');
    setLoadingMessage('Generating questions...');
    setIsLoading(true);

    const questionsPrompt = `Generate a list of 5 insightful and strategic questions for a candidate to ask their interviewer for the FBI Unit Chief for Victim Services position. The questions should demonstrate a deep understanding of the role's challenges, responsibilities, and future direction. Do not provide any conversational text, only the list of questions.

    Job Description Context:
    ${documentContext || "No specific job description provided."}
    `;

    try {
      const response = await callGeminiAPI(TEXT_MODEL, [{ role: 'user', parts: [{ text: questionsPrompt }] }]);
      const questionsText = response.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (questionsText) {
        setFeedback(questionsText);
      } else {
        showMessage('Failed to generate questions. Please try again.');
      }
    } catch (error) {
      console.error('Error generating questions:', error);
      showMessage('An error occurred. Please check the console.');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // Helper function to render a page
  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return (
          <div className="flex flex-col items-center justify-center p-6 space-y-6">
            <div className="flex flex-col items-center space-y-4 mb-4">
                <img src="https://www.fbi.gov/image-repository/fbi-seal.jpg" alt="FBI Badge" className="w-20 h-auto rounded-lg" />
                <h1 className="text-3xl font-bold text-center text-gray-50">FBI Unit Chief for Victim Services Interview Prep</h1>
            </div>
            {userId && (
              <p className="text-gray-400 text-sm">Your User ID: {userId}</p>
            )}
            <p className="text-gray-300 text-center max-w-2xl">
              This comprehensive tool will help you prepare for your high-stakes interview by simulating the experience,
              providing targeted feedback, and helping you structure your answers effectively.
            </p>
            <div className="w-full max-w-md p-4 bg-gray-700 rounded-lg shadow-inner">
              <label htmlFor="document-context" className="block text-gray-200 font-medium mb-2">
                Paste Job Description/Document Context (Optional):
              </label>
              <textarea
                id="document-context"
                value={documentContext}
                onChange={(e) => setDocumentContext(e.target.value)}
                rows="6"
                className="w-full p-2 bg-gray-800 text-gray-100 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Paste the job description or any relevant documents here to make the questions more specific..."
              ></textarea>
            </div>
            
            <div className="w-full max-w-md p-4 bg-gray-700 rounded-lg shadow-inner">
              <label htmlFor="persona-select" className="block text-gray-200 font-medium mb-2">
                Select Interviewer Persona:
              </label>
              <select
                id="persona-select"
                value={selectedPersona}
                onChange={(e) => setSelectedPersona(e.target.value)}
                className="w-full p-2 bg-gray-800 text-gray-100 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="formal">Formal</option>
                <option value="casual">Casual</option>
                <option value="challenging">Challenging</option>
              </select>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 w-full justify-center max-w-md">
              <button
                onClick={startMockInterview}
                className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors duration-200"
              >
                Start Mock Interview
              </button>
              <button
                onClick={startStarAssistant}
                className="w-full px-6 py-3 bg-gray-600 text-gray-100 font-semibold rounded-lg shadow-md hover:bg-gray-700 transition-colors duration-200"
              >
                STAR Method Assistant
              </button>
              <button
                onClick={generateQuestions}
                className="w-full px-6 py-3 bg-gray-600 text-gray-100 font-semibold rounded-lg shadow-md hover:bg-gray-700 transition-colors duration-200"
              >
                Generate Questions
              </button>
              <button
                onClick={() => setCurrentPage('progressDashboard')}
                className="w-full px-6 py-3 bg-gray-600 text-gray-100 font-semibold rounded-lg shadow-md hover:bg-gray-700 transition-colors duration-200"
              >
                Progress Dashboard
              </button>
            </div>
            
            {savedInterviews.length > 0 && (
              <div className="w-full max-w-md p-4 bg-gray-700 rounded-lg shadow-inner">
                <h3 className="text-xl font-semibold text-gray-50 mb-4">Saved Interviews</h3>
                <ul className="space-y-2">
                  {savedInterviews.map((interview) => (
                    <li key={interview.id} className="flex justify-between items-center bg-gray-800 p-3 rounded-md">
                      <span className="text-gray-200 text-sm">
                        {new Date(interview.timestamp?.seconds * 1000).toLocaleString()}
                      </span>
                      <button
                        onClick={() => viewSavedInterview(interview)}
                        className="px-3 py-1 text-xs bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                      >
                        View Feedback
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {savedStarAnswers.length > 0 && (
              <div className="w-full max-w-md p-4 bg-gray-700 rounded-lg shadow-inner">
                <h3 className="text-xl font-semibold text-gray-50 mb-4">Saved STAR Answers</h3>
                <ul className="space-y-2">
                  {savedStarAnswers.map((starAnswer) => (
                    <li key={starAnswer.id} className="flex justify-between items-center bg-gray-800 p-3 rounded-md">
                      <span className="text-gray-200 text-sm italic">
                        "{starAnswer.question.substring(0, 30)}..."
                      </span>
                      <button
                        onClick={() => viewSavedStarAnswer(starAnswer)}
                        className="px-3 py-1 text-xs bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors"
                      >
                        View Answer
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );

      case 'mockInterview':
        return (
          <div className="flex flex-col h-full p-4">
            <div className="flex-grow overflow-y-auto space-y-4 p-4 bg-gray-800 rounded-lg shadow-inner mb-4">
              {chatHistory.map((message, index) => (
                <div key={index} className={`flex ${message.role === 'interviewer' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`p-3 rounded-lg max-w-3/4 ${message.role === 'interviewer' ? 'bg-gray-700 text-gray-200' : 'bg-blue-600 text-white'}`}>
                    {message.text}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="p-3 rounded-lg bg-gray-700 text-gray-200">
                    <span className="animate-pulse">...</span>
                  </div>
                </div>
              )}
              {realTimeTip && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 w-3/4 max-w-md p-3 text-center bg-yellow-500 text-white rounded-lg shadow-lg z-50 animate-bounce-in">
                  {realTimeTip}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitMockAnswer()}
                disabled={isLoading || isSpeaking}
                className="flex-grow p-3 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
                placeholder="Type your response..."
              />
              <button
                onClick={handleStartRecording}
                disabled={isLoading || isRecording || !speechRecognition || isSpeaking}
                className="p-3 bg-red-600 text-white rounded-lg shadow-md hover:bg-red-700 transition-colors duration-200 disabled:bg-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M8.25 4.5a3.75 3.75 0 1 1 7.5 0v8.25a3.75 3.75 0 1 1-7.5 0V4.5z" />
                  <path d="M15.75 17.25a.75.75 0 0 1 .75.75 5.25 5.25 0 1 1-10.5 0 .75.75 0 0 1 .75-.75h.75a3.75 3.75 0 0 0 7.5 0h.75z" />
                </svg>
              </button>
              <button
                onClick={submitMockAnswer}
                disabled={isLoading || !userInput.trim() || isSpeaking}
                className="p-3 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition-colors duration-200 disabled:bg-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
                </svg>
              </button>
            </div>
            <div className="flex justify-between mt-4">
              <button
                onClick={() => setCurrentPage('home')}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
              >
                Exit
              </button>
              <button
                onClick={getInterviewFeedback}
                disabled={chatHistory.length === 0}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors duration-200 disabled:bg-gray-600"
              >
                Get Feedback
              </button>
            </div>
          </div>
        );

      case 'feedback':
        return (
          <div className="flex flex-col h-full p-4 items-center">
            <h2 className="text-2xl font-bold text-gray-50 mb-4 text-center">Interview Feedback</h2>
            <div className="w-full flex-grow p-6 bg-gray-800 rounded-lg shadow-inner overflow-y-auto text-gray-200">
              {isLoading ? (
                <div className="flex justify-center items-center h-full">
                  <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4"></div>
                  <p className="text-lg">{loadingMessage}</p>
                </div>
              ) : feedback ? (
                <div className="space-y-6">
                  <div className="flex flex-col items-center">
                    <h3 className="text-lg font-semibold text-gray-100">Overall Score</h3>
                    <div className="text-5xl font-extrabold text-blue-400 mt-2">{feedback.score}/10</div>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-semibold text-gray-100">Strengths</h3>
                    <ul className="list-disc list-inside space-y-1 mt-2">
                      {feedback.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-semibold text-gray-100">Areas for Improvement</h3>
                    <ul className="list-disc list-inside space-y-1 mt-2">
                      {feedback.improvements.map((i, idx) => (
                        <li key={idx}>{i}</li>
                      ))}
                    </ul>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-semibold text-gray-100">Ideal Answers</h3>
                    <div className="space-y-4 mt-2">
                      {Object.keys(feedback.ideal_answers).map((question, i) => (
                        <div key={i} className="bg-gray-700 p-4 rounded-lg">
                          <p className="font-medium text-gray-300">Question: <span className="text-gray-100">{question}</span></p>
                          <p className="mt-2 text-gray-200">{feedback.ideal_answers[question]}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-center">No feedback available. Please complete a mock interview first.</p>
              )}
            </div>
            <button
              onClick={() => setCurrentPage('home')}
              className="mt-4 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
            >
              Back to Home
            </button>
          </div>
        );

      case 'starMethod':
        const starPrompts = [
          'What behavioral question would you like to practice?',
          'Describe the **Situation**. What was the context or background?',
          'What was your specific **Task** or responsibility in that situation?',
          'What **Actions** did you take to address the task?',
          'What was the **Result** of your actions?'
        ];
        const starLabels = ['Question', 'Situation', 'Task', 'Action', 'Result'];

        return (
          <div className="flex flex-col h-full p-4 items-center justify-center">
            <h2 className="text-2xl font-bold text-gray-50 mb-4 text-center">STAR Method Assistant</h2>
            <div className="w-full max-w-2xl bg-gray-800 p-6 rounded-lg shadow-inner space-y-4">
              <p className="text-gray-300 text-lg">{starPrompts[starState]}</p>
              {starState === 5 && (
                <div className="mt-4 p-4 bg-gray-700 rounded-md">
                  <h3 className="text-lg font-semibold text-gray-100">Your STAR Answer:</h3>
                  <div dangerouslySetInnerHTML={{ __html: finalStarAnswer.replace(/\n/g, '<br />') }} className="text-gray-200 mt-2" />
                </div>
              )}
              {starState < 5 && (
                <div className="flex flex-col">
                  <label htmlFor="star-input" className="sr-only">{starLabels[starState]}</label>
                  <textarea
                    id="star-input"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    rows="4"
                    className="w-full p-3 bg-gray-700 text-white rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400"
                    placeholder={`Enter your ${starLabels[starState]}...`}
                  ></textarea>
                  <button
                    onClick={submitStarAnswer}
                    disabled={!userInput.trim()}
                    className="mt-4 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition-colors duration-200 disabled:bg-gray-600"
                  >
                    Next
                  </button>
                </div>
              )}
              <button
                onClick={() => setCurrentPage('home')}
                className="w-full mt-4 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
              >
                Back to Home
              </button>
            </div>
          </div>
        );

      case 'questionGenerator':
        return (
          <div className="flex flex-col h-full p-4 items-center">
            <h2 className="text-2xl font-bold text-gray-50 mb-4 text-center">Interview Question Generator</h2>
            <div className="w-full max-w-2xl flex-grow p-6 bg-gray-800 rounded-lg shadow-inner overflow-y-auto text-gray-200">
              {isLoading ? (
                <div className="flex justify-center items-center h-full">
                  <div className="loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-12 w-12 mb-4"></div>
                  <p className="text-lg">{loadingMessage}</p>
                </div>
              ) : feedback ? (
                <div dangerouslySetInnerHTML={{ __html: feedback.replace(/\n/g, '<br />') }} />
              ) : (
                <p className="text-center">Questions will appear here. The job description context from the home page will be used if provided.</p>
              )}
            </div>
            <button
              onClick={() => setCurrentPage('home')}
              className="mt-4 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
            >
              Back to Home
            </button>
          </div>
        );

      case 'progressDashboard':
        return (
          <div className="flex flex-col h-full p-4 items-center">
            <h2 className="text-2xl font-bold text-gray-50 mb-4 text-center">Progress Dashboard</h2>
            <p className="text-gray-300 text-center max-w-2xl mb-6">
              Track your interview performance and review your saved work.
            </p>
            <div className="w-full max-w-3xl flex-grow overflow-y-auto space-y-8">
              
              {/* Interview Score Chart (Simple Representation) */}
              <div className="bg-gray-800 p-6 rounded-lg shadow-inner">
                <h3 className="text-xl font-semibold text-gray-50 mb-4">Interview Score Trends</h3>
                {savedInterviews.length > 0 ? (
                  <div className="flex flex-col items-center">
                    <div className="flex justify-around items-end w-full h-40 bg-gray-700 rounded-lg p-2">
                      {savedInterviews.slice().reverse().map((interview, index) => (
                        <div key={index} className="flex flex-col items-center group relative">
                          <div
                            className="w-6 bg-blue-500 rounded-t-full transition-all duration-300 hover:bg-blue-400"
                            style={{ height: `${interview.feedback?.score * 10}%` }}
                          ></div>
                          <span className="text-xs text-gray-300 mt-2">{interview.feedback?.score}</span>
                          <div className="absolute top-0 transform -translate-y-full -translate-x-1/2 left-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gray-900 text-white text-xs rounded py-1 px-2 pointer-events-none">
                            {new Date(interview.timestamp?.seconds * 1000).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                    <span className="text-gray-400 text-sm mt-2">Interview Scores over Time</span>
                  </div>
                ) : (
                  <p className="text-center text-gray-400">Complete mock interviews to see your progress here.</p>
                )}
              </div>

              {/* Saved Interviews List */}
              <div className="bg-gray-800 p-6 rounded-lg shadow-inner">
                <h3 className="text-xl font-semibold text-gray-50 mb-4">Saved Interviews</h3>
                {savedInterviews.length > 0 ? (
                  <ul className="space-y-2">
                    {savedInterviews.map((interview) => (
                      <li key={interview.id} className="flex justify-between items-center bg-gray-700 p-3 rounded-md">
                        <div className="flex flex-col">
                          <span className="text-gray-200">Interview on {new Date(interview.timestamp?.seconds * 1000).toLocaleString()}</span>
                          <span className="text-gray-400 text-sm">Score: {interview.feedback?.score}/10</span>
                        </div>
                        <button
                          onClick={() => viewSavedInterview(interview)}
                          className="px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                        >
                          View Feedback
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center text-gray-400">No saved interviews found.</p>
                )}
              </div>

              {/* Saved STAR Answers List */}
              <div className="bg-gray-800 p-6 rounded-lg shadow-inner">
                <h3 className="text-xl font-semibold text-gray-50 mb-4">Saved STAR Answers</h3>
                {savedStarAnswers.length > 0 ? (
                  <ul className="space-y-2">
                    {savedStarAnswers.map((starAnswer) => (
                      <li key={starAnswer.id} className="flex justify-between items-center bg-gray-700 p-3 rounded-md">
                        <span className="text-gray-200 text-sm italic">
                          "{starAnswer.question.substring(0, 30)}..."
                        </span>
                        <button
                          onClick={() => viewSavedStarAnswer(starAnswer)}
                          className="px-3 py-1 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors"
                        >
                          View Answer
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center text-gray-400">No saved STAR answers found.</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setCurrentPage('home')}
              className="mt-4 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
            >
              Back to Home
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .loader {
          border-top-color: #3498db;
          -webkit-animation: spinner 1.5s linear infinite;
          animation: spinner 1.5s linear infinite;
        }
        @-webkit-keyframes spinner {
          0% { -webkit-transform: rotate(0deg); }
          100% { -webkit-transform: rotate(360deg); }
        }
        @keyframes spinner {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .animate-bounce-in {
          animation: bounce-in 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
        }
        @keyframes bounce-in {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.1); opacity: 1; }
          80% { transform: scale(0.9); }
          100% { transform: scale(1); }
        }
      `}</style>
      <div className="w-full max-w-4xl p-6 bg-gray-800 rounded-xl shadow-2xl h-[calc(100vh-2rem)] flex flex-col">
        {renderPage()}
        {loadingMessage && (
          <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg shadow-lg text-white text-center">
              {loadingMessage === 'Analyzing your performance...' || loadingMessage === 'Generating questions...' || loadingMessage === 'Initializing mock interview...' ? (
                <div className="flex flex-col items-center">
                  <div className="loader ease-linear rounded-full border-4 border-t-4 border-blue-500 h-12 w-12 mb-4"></div>
                  <p>{loadingMessage}</p>
                </div>
              ) : (
                <p>{loadingMessage}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;


