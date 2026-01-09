const axios = require('axios');
const bizSdk = require('facebook-nodejs-business-sdk');
const FacebookAdAccount = require('../models/FacebookAdAccount');

const { FacebookAdsApi, AdAccount, Campaign } = bizSdk;
const API_VERSION = process.env.FACEBOOK_API_VERSION || 'v20.0';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const OAUTH_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_read_engagement',
].join(',');

const OBJECTIVE_MAP = {
  traffic: 'OUTCOME_TRAFFIC',
  leads: 'OUTCOME_LEADS',
  sales: 'OUTCOME_SALES',
};

const OPTIMIZATION_MAP = {
  traffic: 'OUTCOME_TRAFFIC',
  leads: 'OUTCOME_LEADS',
  sales: 'OUTCOME_SALES',
};

const buildStateToken = (userId) => {
  const payload = JSON.stringify({
    userId,
    issuedAt: Date.now(),
  });
  return Buffer.from(payload).toString('base64');
};

const readStateToken = (state) => {
  try {
    return JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
  } catch (error) {
    return {};
  }
};

const ensureEnv = (...keys) => {
  keys.forEach((key) => {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  });
};

const getFacebookAuthUrl = (user) => {
  ensureEnv('FACEBOOK_APP_ID', 'FACEBOOK_REDIRECT_URI');

  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID,
    redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    response_type: 'code',
    state: buildStateToken(user._id.toString()),
  });

  return `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params.toString()}`;
};

const exchangeCodeForToken = async (code) => {
  ensureEnv('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_REDIRECT_URI');

  const response = await axios.get(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`, {
    params: {
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
      code,
    },
  });

  if (response.data?.access_token) {
    return response.data;
  }

  throw new Error('Unable to exchange code for access token');
};

const extendAccessToken = async (shortLivedToken) => {
  ensureEnv('FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET');

  const response = await axios.get(`https://graph.facebook.com/${API_VERSION}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.FACEBOOK_APP_ID,
      client_secret: process.env.FACEBOOK_APP_SECRET,
      fb_exchange_token: shortLivedToken,
    },
  });

  return response.data?.access_token || shortLivedToken;
};

const fetchPrimaryAdAccount = async (accessToken) => {
  const response = await axios.get(`https://graph.facebook.com/${API_VERSION}/me/adaccounts`, {
    params: {
      access_token: accessToken,
      limit: 1,
    },
  });

  return response.data?.data?.[0]?.id || process.env.FACEBOOK_DEFAULT_AD_ACCOUNT;
};

const handleFacebookCallback = async ({ code, state }) => {
  const decodedState = readStateToken(state);

  if (!decodedState.userId) {
    throw new Error('Invalid OAuth state payload');
  }

  const tokenData = await exchangeCodeForToken(code);
  const longLivedToken = await extendAccessToken(tokenData.access_token);
  const adAccountId = await fetchPrimaryAdAccount(longLivedToken);

  if (!adAccountId) {
    throw new Error('Unable to determine an ad account for this user');
  }

  await FacebookAdAccount.findOneAndUpdate(
    { user: decodedState.userId },
    {
      adAccountId,
      accessToken: longLivedToken,
      expiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      metadata: {
        lastSynced: new Date(),
        scopes: OAUTH_SCOPES.split(','),
      },
    },
    { upsert: true, new: true }
  );

  return decodedState.userId;
};

const getConnectionStatus = async (userId) => {
  const account = await FacebookAdAccount.findOne({ user: userId }).lean();

  if (!account) {
    return {
      connected: false,
    };
  }

  return {
    connected: true,
    adAccountId: account.adAccountId,
    expiresAt: account.expiresAt,
    lastSynced: account.metadata?.lastSynced,
  };
};

const toMinorUnits = (amount) => Math.max(100, Math.round(Number(amount || 0) * 100));

const buildCreativeSpec = ({ destinationUrl, businessCategory }) => {
  ensureEnv('FACEBOOK_DEFAULT_PAGE_ID');

  return {
    page_id: process.env.FACEBOOK_DEFAULT_PAGE_ID,
    link_data: {
      message: `Scale your ${businessCategory} campaigns with Tabalt's experts.`,
      link: destinationUrl,
      caption: 'Powered by Tabalt',
      description: 'Automated Facebook & Instagram ads managed by Tabalt.',
      call_to_action: {
        type: 'LEARN_MORE',
        value: {
          link: destinationUrl,
        },
      },
      // TODO: Use image hashes uploaded via the Marketing API.
      image_hash: process.env.FACEBOOK_DEFAULT_IMAGE_HASH,
    },
  };
};

const launchQuickCampaign = async ({
  userId,
  goal,
  dailyBudget,
  destinationUrl,
  businessCategory,
}) => {
  const account = await FacebookAdAccount.findOne({ user: userId });
  if (!account) {
    const err = new Error('FACEBOOK_NOT_CONNECTED');
    err.code = 'FACEBOOK_NOT_CONNECTED';
    throw err;
  }

  FacebookAdsApi.init(account.accessToken);
  const adAccount = new AdAccount(account.adAccountId);

  const campaign = await adAccount.createCampaign([], {
    name: `QuickLaunch • ${goal} • ${new Date().toISOString()}`,
    objective: OBJECTIVE_MAP[goal] || OBJECTIVE_MAP.traffic,
    status: Campaign.Status.paused,
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: ['NONE'],
  });

  const adSet = await adAccount.createAdSet([], {
    name: `QuickLaunch • Set`,
    campaign_id: campaign.id,
    daily_budget: toMinorUnits(dailyBudget),
    billing_event: 'IMPRESSIONS',
    optimization_goal: OPTIMIZATION_MAP[goal] || OPTIMIZATION_MAP.traffic,
    destination_type: 'WEBSITE',
    targeting: {
      geo_locations: {
        countries: ['GB'],
      },
      publisher_platforms: ['facebook', 'instagram', 'messenger', 'audience_network'],
      facebook_positions: ['feed', 'marketplace', 'video_feeds'],
    },
    status: 'PAUSED',
    attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }],
  });

  const creative = await adAccount.createAdCreative([], {
    name: 'QuickLaunch • Creative',
    object_story_spec: buildCreativeSpec({ destinationUrl, businessCategory }),
  });

  const ad = await adAccount.createAd([], {
    name: 'QuickLaunch • Ad',
    adset_id: adSet.id,
    creative: { creative_id: creative.id },
    status: 'PAUSED',
  });

  await Promise.all([
    campaign.update({ status: Campaign.Status.active }),
    adSet.update({ status: 'ACTIVE' }),
    ad.update({ status: 'ACTIVE' }),
  ]);

  return {
    campaignId: campaign.id,
    adSetId: adSet.id,
    adId: ad.id,
  };
};

module.exports = {
  getFacebookAuthUrl,
  handleFacebookCallback,
  getConnectionStatus,
  launchQuickCampaign,
  FRONTEND_URL,
};

