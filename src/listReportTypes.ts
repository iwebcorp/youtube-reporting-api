import { google } from 'googleapis';
import { getAuthClient } from './auth';

async function listReportTypes() {
  const contentOwnerId = '2jFu0i9K0PE3MDrkU_UUfQ';
  try {
    const authClient = await getAuthClient();
    const ytReporting = google.youtubereporting({ version: 'v1', auth: authClient });
    const res = await ytReporting.reportTypes.list({
      onBehalfOfContentOwner: contentOwnerId,
    });
    console.log(res.data.reportTypes?.map(rt => rt.id));
  } catch (error) {
    console.error('Error listing report types:', error);
  }
}

listReportTypes();
