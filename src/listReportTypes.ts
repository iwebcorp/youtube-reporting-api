import { google } from 'googleapis';
import { getAuthClient } from './auth';
import { loadConfig } from './configLoader';

const cfg = loadConfig();

async function listReportTypes() {
  try {
    const authClient = await getAuthClient();
    const ytReporting = google.youtubereporting({ version: 'v1', auth: authClient });
    const res = await ytReporting.reportTypes.list({
      onBehalfOfContentOwner: cfg.contentOwnerId,
    });
    console.log(res.data.reportTypes?.map(rt => rt.id));
  } catch (error) {
    console.error('Error listing report types:', error);
  }
}

listReportTypes();
