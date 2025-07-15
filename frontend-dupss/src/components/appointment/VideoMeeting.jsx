import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MeetingProvider, MeetingConsumer, useMeeting } from '@videosdk.live/react-sdk';
import { getToken, validateMeeting, createMeeting } from '../../services/videoService';
import { Box, Typography, TextField, Button, CircularProgress, Container, Paper, Stack, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText, TextareaAutosize } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import { getUserData } from '../../services/authService';
import axios from 'axios';
import apiService from '../../services/apiService';
import { showSuccessAlert, showErrorAlert } from '../common/AlertNotification';
import { API_URL } from '../../services/config';

import MeetingContainer from './VideoMeetingComponents/MeetingContainer';
import JoiningScreen from './VideoMeetingComponents/JoiningScreen';

// Create a wrapper component to access meeting methods
const MeetingWrapper = ({ children, meetingRef }) => {
  const meeting = useMeeting();
  
  // Store meeting reference for external access
  React.useEffect(() => {
    if (meeting) {
      meetingRef.current = meeting;
    }
  }, [meeting, meetingRef]);
  
  return children;
};

const VideoMeeting = () => {
  const { videoCallId, appointmentId } = useParams();
  const navigate = useNavigate();
  
  // Add ref to store meeting object
  const meetingRef = useRef(null);
  
  const [token, setToken] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [webcamOn, setWebcamOn] = useState(true);
  const [isMeetingStarted, setIsMeetingStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // State for consultant functionality
  const [isConsultant, setIsConsultant] = useState(false);
  const [openStartDialog, setOpenStartDialog] = useState(false);
  const [openEndDialog, setOpenEndDialog] = useState(false);
  const [consultantNote, setConsultantNote] = useState('');
  
  // Custom audio/video streams (optional)
  const [customAudioStream, setCustomAudioStream] = useState(null);
  const [customVideoStream, setCustomVideoStream] = useState(null);

  // Add useEffect to monitor changes to openStartDialog
  useEffect(() => {
    console.log("openStartDialog changed:", openStartDialog);
  }, [openStartDialog]);

  // Add cleanup effect to ensure meeting is left if component unmounts unexpectedly
  useEffect(() => {
    return () => {
      // When component unmounts, ensure meeting is properly left
      if (meetingRef.current && typeof meetingRef.current.leave === 'function') {
        console.log("Unmounting VideoMeeting component - cleaning up meeting session");
        try {
          // Stop screen sharing explicitly if active
          if (meetingRef.current.localScreenShareOn && typeof meetingRef.current.stopScreenShare === 'function') {
            meetingRef.current.stopScreenShare();
          }
          
          // Now leave the meeting
          meetingRef.current.leave();
        } catch (err) {
          console.error("Error leaving meeting on unmount:", err);
        }
      }
      
      // Clean up any media streams
      if (customAudioStream) {
        customAudioStream.getTracks().forEach(track => track.stop());
      }
      if (customVideoStream) {
        customVideoStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [customAudioStream, customVideoStream]);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        console.log("Parameters:", { appointmentId, videoCallId });
        
        const tokenResponse = await getToken();
        setToken(tokenResponse);
        
        // Check if user is a consultant
        const userData = getUserData();
        if (userData && userData.roles && userData.roles.includes('ROLE_CONSULTANT')) {
          setIsConsultant(true);
        }
        
        // Check if user is authenticated and prefill their name
        if (userData) {
          try {
            // Use access token directly to get user details
            const accessToken = localStorage.getItem('accessToken');
            if (accessToken) {
              const response = await axios.post(`${API_URL}/auth/me`, { accessToken });
              if (response && response.data && response.data.fullName) {
                setParticipantName(response.data.fullName);
              }
            }
          } catch (userError) {
            console.error("Error fetching user data:", userError);
            // Still allow meeting to proceed even if user info can't be fetched
          }
        }

        // Luôn sử dụng videoCallId từ URL làm meetingId
        if (videoCallId) {
          console.log("Attempting to join meeting with ID:", videoCallId);
          setMeetingId(videoCallId);
          
          const { meetingId: validMeetingId, err } = await validateMeeting({ 
            roomId: videoCallId, 
            token: tokenResponse 
          });
          
          if (err) {
            console.error("Meeting validation error:", err);
            setError("Cuộc họp không tồn tại hoặc đã kết thúc");
          } else {
            console.log("Meeting is valid:", validMeetingId);
          }
        } else {
          console.error("No videoCallId provided in URL");
          setError("ID cuộc họp không hợp lệ");
        }
        
        setLoading(false);
      } catch (error) {
        console.error("Error initializing meeting:", error);
        setError("Không thể kết nối với máy chủ hội nghị");
        setLoading(false);
      }
    };
    
    init();
  }, [videoCallId, appointmentId]);

  const onClickStartMeeting = async () => {
    if (!participantName.trim()) {
      setError("Vui lòng nhập tên của bạn");
      return;
    }
    
    try {
      setLoading(true);
      
      // If user is a consultant, check appointment status before deciding on dialog
      if (isConsultant) {
        // Check appointment status first
        let appointmentData;
        try {
          appointmentData = await checkAppointmentStatus();
          console.log("Current appointment status:", appointmentData.status);
          console.log("Status comparison:", {
            actualStatus: appointmentData.status,
            expectedStatus: 'CONFIRMED'
          });
          
          // Force status comparison as string with strict equality
          const appointmentStatus = String(appointmentData.status).toUpperCase();
          const confirmedStatus = 'CONFIRMED';
          
          console.log("Normalized status:", appointmentStatus);
          console.log("Is exactly CONFIRMED:", appointmentStatus === confirmedStatus);
          
          // Only show confirmation dialog if status is CONFIRMED
          // For other statuses, just join the meeting directly
          if (appointmentStatus === confirmedStatus) {
            console.log("Should show start dialog now");
            // Set loading to false first
            setLoading(false);
            // Ensure dialog opens with a slight delay to avoid race conditions
            setTimeout(() => {
              setOpenStartDialog(true);
            }, 100);
            return;
          } else {
            // For other statuses, join directly
            console.log(`Joining meeting directly as status is ${appointmentData.status}`);
            setIsMeetingStarted(true);
            setError("");
            setLoading(false);
            return;
          }
        } catch (statusError) {
          console.error("Failed to check appointment status:", statusError);
          appointmentData = { status: "UNKNOWN" };
          // If status check fails, default to showing dialog
          setLoading(false);
          setTimeout(() => {
            setOpenStartDialog(true);
          }, 100);
          return;
        }
      }
      
      console.log(`Joining meeting ${meetingId} as ${participantName}`);
      setIsMeetingStarted(true);
      setError("");
      setLoading(false);
    } catch (error) {
      console.error("Error joining meeting:", error);
      setError("Không thể tham gia cuộc họp");
      setLoading(false);
    }
  };

  // Function to refresh access token using refresh token
  const refreshAccessToken = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }
      
      console.log("Attempting to refresh access token");
      
      const response = await fetch(`${API_URL}/auth/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to refresh token: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data.accessToken) {
        console.log("Successfully refreshed access token");
        localStorage.setItem('accessToken', data.accessToken);
        return data.accessToken;
      } else {
        throw new Error('Invalid response from refresh token API');
      }
    } catch (error) {
      console.error("Error refreshing token:", error);
      throw error;
    }
  };

  // Function to check appointment status
  const checkAppointmentStatus = async () => {
    try {
      const userData = getUserData();
      if (!userData || !userData.id) {
        throw new Error('Không tìm thấy thông tin người dùng');
      }
      
      console.log("Checking appointment status for ID:", appointmentId);
      
      // Try to get appointment status, with token refresh if needed
      return await fetchAppointmentWithTokenRefresh();
    } catch (error) {
      console.error("Error checking appointment status:", error);
      // Return a default object instead of throwing error
      return { status: "UNKNOWN" };
    }
  };
  
  // Helper function to fetch appointment with token refresh if needed
  const fetchAppointmentWithTokenRefresh = async (isRetry = false) => {
    // Get access token from localStorage
    let accessToken = localStorage.getItem('accessToken');
    if (!accessToken) {
      console.error("No access token available");
      return { status: "UNKNOWN" };
    }

    console.log("Making API call to check appointment status");
    
    try {
      // Make a direct API call with explicit headers
      const response = await fetch(`${API_URL}/appointments/${appointmentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log("API response status:", response.status);
      
      // If unauthorized and not already retrying, try refreshing token
      if (response.status === 401 && !isRetry) {
        console.log("Unauthorized error. Attempting to refresh token and retry...");
        try {
          // Get new access token
          accessToken = await refreshAccessToken();
          // Retry the call with new token
          return await fetchAppointmentWithTokenRefresh(true);
        } catch (refreshError) {
          console.error("Failed to refresh token:", refreshError);
          return { status: "UNKNOWN" };
        }
      }
      
      if (!response.ok) {
        console.error(`API error: ${response.status} ${response.statusText}`);
        return { status: "UNKNOWN" };
      }
      
      const data = await response.json();
      console.log("Full appointment data:", data);
      
      if (!data || !data.status) {
        console.warn("Invalid data format from API");
        return { status: "UNKNOWN" };
      }
      
      console.log("Appointment status from API:", data.status);
      return data;
    } catch (error) {
      console.error("Error in fetchAppointmentWithTokenRefresh:", error);
      return { status: "UNKNOWN" };
    }
  };

  const handleConfirmStartMeeting = async () => {
    try {
      setLoading(true);
      setOpenStartDialog(false);
      
      // Get user ID for the API call
      const userData = getUserData();
      if (!userData || !userData.id) {
        throw new Error('Không tìm thấy thông tin người dùng');
      }

      // Check appointment status first
      let appointmentData;
      try {
        appointmentData = await checkAppointmentStatus();
      } catch (statusError) {
        console.error("Failed to check appointment status:", statusError);
        appointmentData = { status: "UNKNOWN" };
      }
      
      // Only call start API if appointment status is CONFIRMED
      // Backend only allows starting appointments with CONFIRMED status
      if (appointmentData.status === 'CONFIRMED') {
        console.log('Starting appointment with ID:', appointmentId);
        console.log('Consultant ID:', userData.id);
        
        // Use apiService instead of direct axios call for proper authentication handling
        await apiService.put(`/appointments/${appointmentId}/start?consultantId=${userData.id}`, {});
        showSuccessAlert('Bắt đầu buổi tư vấn thành công!');
      } else if (appointmentData.status === 'ON_GOING') {
        // If appointment is already ongoing, just join without calling API
        console.log('Appointment is already in ON_GOING status, joining directly');
      } else if (appointmentData.status === 'COMPLETED') {
        // If appointment is completed, just join without calling API
        console.log('Appointment is already COMPLETED, joining directly');
      } else {
        // For any other status, show warning but allow joining
        console.warn(`Appointment has status ${appointmentData.status}, which might cause issues`);
      }
      
      // Start the meeting regardless of status
      console.log(`Joining meeting ${meetingId} as ${participantName} (consultant)`);
      setIsMeetingStarted(true);
      setError("");
    } catch (error) {
      console.error("Error starting appointment:", error);
      const errorMessage = error.response?.data?.message || 
                         error.response?.data?.error || 
                         error.message || 
                         'Lỗi không xác định';
      showErrorAlert('Không thể bắt đầu buổi tư vấn: ' + errorMessage);
      setLoading(false);
    }
  };

  const handleEndMeeting = () => {
    if (isConsultant) {
      // Check appointment status before showing end dialog
      checkAppointmentStatus().then(appointmentData => {
        // Only show end dialog if status is ON_GOING
        if (appointmentData.status === 'ON_GOING') {
          setOpenEndDialog(true);
        } else {
          // For other statuses, just leave directly
          handleOnMeetingLeave();
        }
      }).catch(error => {
        console.error("Error checking status before ending:", error);
        // If error checking status, just show dialog to be safe
        setOpenEndDialog(true);
      });
    } else {
      handleOnMeetingLeave();
    }
  };
  
  // Handle confirmation of ending meeting
  const handleConfirmEndMeeting = async () => {
    try {
      setOpenEndDialog(false);
      
      // Get user ID for the API call
      const userData = getUserData();
      if (!userData || !userData.id) {
        throw new Error('Không tìm thấy thông tin người dùng');
      }
      
      // Check appointment status first
      let appointmentData;
      try {
        appointmentData = await checkAppointmentStatus();
      } catch (statusError) {
        console.error("Failed to check appointment status:", statusError);
        appointmentData = { status: "UNKNOWN" };
      }
      
      // Only call end API if appointment is not already COMPLETED
      if (appointmentData.status === 'ON_GOING') {
        console.log('Ending appointment with ID:', appointmentId);
        console.log('Consultant ID:', userData.id);
        console.log('With consultant note:', consultantNote ? 'Yes' : 'No');
        
        // Use apiService instead of direct axios call for proper authentication handling
        await apiService.put(`/appointments/${appointmentId}/end?consultantId=${userData.id}`, {
          consultantNote
        });
        
        showSuccessAlert('Hoàn thành buổi tư vấn thành công!');
      }
      
      // Now leave the meeting using the ref
      if (meetingRef.current && typeof meetingRef.current.leave === 'function') {
        meetingRef.current.leave();
      }
      
      // Navigate away
      handleOnMeetingLeave();
    } catch (error) {
      console.error("Error ending appointment:", error);
      const errorMessage = error.response?.data?.message || 
                          error.response?.data?.error || 
                          error.message || 
                          'Lỗi không xác định';
      showErrorAlert('Không thể kết thúc buổi tư vấn: ' + errorMessage);
    }
  };

  const handleOnMeetingLeave = useCallback(() => {
    // Make sure to properly clean up the meeting to avoid lingering participants
    if (meetingRef.current && typeof meetingRef.current.leave === 'function') {
      meetingRef.current.leave();
    }
    
    // Clean up any media streams
    if (customAudioStream) {
      customAudioStream.getTracks().forEach(track => track.stop());
    }
    if (customVideoStream) {
      customVideoStream.getTracks().forEach(track => track.stop());
    }
    
    // Clear the meeting reference to avoid memory leaks
    meetingRef.current = null;
    
    // Now set the state and navigate
    setIsMeetingStarted(false);
    navigate('/');
  }, [navigate, customAudioStream, customVideoStream]);

  // Generate a stable participant ID based on user information and meeting
  const getParticipantId = () => {
    // Get user ID from localStorage if available (assuming user profile is stored there)
    const userProfile = localStorage.getItem('userProfile');
    let userId;
    
    if (userProfile) {
      try {
        const profile = JSON.parse(userProfile);
        userId = profile.id || profile.userId || profile.email;
      } catch (e) {
        console.error("Error parsing user profile", e);
      }
    }
    
    // If we have a user ID, use it combined with the meeting ID to create a stable ID
    // Otherwise, fall back to a session-specific ID that will at least be consistent within this tab
    if (userId) {
      const participantId = `user-${userId}-meeting-${meetingId}`;
      console.log("Generated participant ID:", participantId);
      return participantId;
    } else if (!window.sessionStorage.getItem('tempParticipantId')) {
      window.sessionStorage.setItem('tempParticipantId', window.crypto.randomUUID());
    }
    
    const tempId = window.sessionStorage.getItem('tempParticipantId');
    console.log("Using temporary participant ID:", tempId);
    return tempId;
  };

  // Update how we pass the meeting leave handler to the MeetingContainer
  // instead of passing onMeetingLeave directly, we'll pass a function to show the end dialog
  const handleShowEndDialog = useCallback(() => {
    if (isConsultant) {
      // Set loading in the dialog to indicate checking status
      setConsultantNote(''); // Reset note
      setOpenEndDialog(true);  // Show dialog immediately so user gets feedback
      
      // Check appointment status in background
      checkAppointmentStatus().then(appointmentData => {
        if (appointmentData.status !== 'ON_GOING') {
          // For other statuses, just leave directly
          setOpenEndDialog(false);
          handleOnMeetingLeave();
        }
        // Otherwise, keep dialog open for user to confirm and add notes
      }).catch(error => {
        console.error("Error checking status before ending:", error);
        // On error, show error message but keep dialog open
        showErrorAlert('Không thể kiểm tra trạng thái cuộc hẹn: ' + (error.message || 'Lỗi không xác định'));
      });
    } else {
      handleOnMeetingLeave();
    }
  }, [isConsultant]);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {loading && !isMeetingStarted ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 8 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Paper elevation={3} sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" color="error" gutterBottom>
            {error}
          </Typography>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={() => navigate('/')}
            sx={{ mt: 2 }}
          >
            Trở về trang chủ
          </Button>
        </Paper>
      ) : isMeetingStarted ? (
        <MeetingProvider
          config={{
            meetingId,
            micEnabled: micOn,
            webcamEnabled: webcamOn,
            name: participantName,
            participantId: getParticipantId(),
            customAudioStream,
            customVideoStream,
          }}
          token={token}
          joinWithoutUserInteraction={true}
        >
          <MeetingWrapper meetingRef={meetingRef}>
          <MeetingConsumer>
            {() => (
              <MeetingContainer
                  onMeetingLeave={handleShowEndDialog}
                setIsMeetingStarted={setIsMeetingStarted}
                isConsultant={isConsultant}
              />
            )}
          </MeetingConsumer>
          </MeetingWrapper>
        </MeetingProvider>
      ) : (
        <JoiningScreen
          participantName={participantName}
          setParticipantName={setParticipantName}
          meetingId={meetingId}
          setMeetingId={setMeetingId}
          micOn={micOn}
          setMicOn={setMicOn}
          webcamOn={webcamOn}
          setWebcamOn={setWebcamOn}
          onClickStartMeeting={onClickStartMeeting}
          setCustomAudioStream={setCustomAudioStream}
          setCustomVideoStream={setCustomVideoStream}
          isConsultant={isConsultant}
        />
      )}
      
      {/* Start Meeting Dialog for consultants */}
      <Dialog
        open={openStartDialog}
        onClose={() => setOpenStartDialog(false)}
        aria-labelledby="start-dialog-title"
      >
        <DialogTitle sx={{fontWeight: 600, color: '#0056b3'}} id="start-dialog-title">
          Xác nhận tiến hành tư vấn
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Bạn muốn bắt đầu buổi tư vấn này? Hệ thống sẽ cập nhật trạng thái buổi tư vấn thành "Đang diễn ra".
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenStartDialog(false)} color="primary">
            Hủy
          </Button>
          <Button onClick={handleConfirmStartMeeting} color="primary" variant="contained">
            Xác nhận
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* End Meeting Dialog for consultants */}
      <Dialog
        open={openEndDialog}
        onClose={() => setOpenEndDialog(false)}
        aria-labelledby="end-dialog-title"
        fullWidth
        maxWidth="sm"
        // Update styling to ensure dialog appears properly over video
        sx={{ 
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(0, 0, 0, 0.5)'
          },
          position: 'absolute',
          zIndex: 1400
        }}
      >
        <DialogTitle sx={{fontWeight: 600, color: '#0056b3'}}  id="end-dialog-title">
          Xác nhận hoàn thành buổi tư vấn
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{color: '#000000'}} gutterBottom>
            Bạn muốn kết thúc buổi tư vấn này? Hệ thống sẽ cập nhật trạng thái buổi tư vấn thành "Đã hoàn thành".
          </DialogContentText>
          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            Ghi chú của tư vấn viên:
          </Typography>
          <TextareaAutosize
            minRows={4}
            style={{ 
              width: '100%', 
              padding: '10px', 
              borderRadius: '4px', 
              border: '1px solid #ccc',
              marginTop: '8px'
            }}
            placeholder="Nhập ghi chú của bạn về buổi tư vấn..."
            value={consultantNote}
            onChange={(e) => setConsultantNote(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenEndDialog(false)} color="primary">
            Hủy
          </Button>
          <Button onClick={handleConfirmEndMeeting} color="primary" variant="contained">
            Xác nhận
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default VideoMeeting; 