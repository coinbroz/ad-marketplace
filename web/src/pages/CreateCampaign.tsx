import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Section, Cell, Button, Input } from '@telegram-apps/telegram-ui';
import { createCampaign } from '../api/client';
import { LanguageInput } from '../components/LanguageInput';
import type { User } from '../types';

interface Props {
  user: User | null;
}

export function CreateCampaignPage({ user }: Props) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [budgetPerPost, setBudgetPerPost] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('');
  const [minSubscribers, setMinSubscribers] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !description.trim() || !budgetPerPost) {
      window.Telegram?.WebApp?.showAlert?.('Please fill in title, description, and budget');
      return;
    }

    const budget = parseFloat(budgetPerPost);
    if (isNaN(budget) || budget <= 0) {
      window.Telegram?.WebApp?.showAlert?.('Budget must be a positive number');
      return;
    }

    setSaving(true);
    try {
      const campaign = await createCampaign({
        title: title.trim(),
        description: description.trim(),
        budgetPerPost: budget,
        targetLanguage: targetLanguage.trim() || undefined,
        minSubscribers: minSubscribers ? parseInt(minSubscribers, 10) : undefined,
      });
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      window.Telegram?.WebApp?.showAlert?.(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Section header="Create Campaign">
        <Cell subtitle="Create an ad campaign brief for channel owners to apply">
          Fill in the details below
        </Cell>
      </Section>

      <Section header="Campaign Details">
        <Input
          header="Campaign Title"
          placeholder="Campaign title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          header="Description / Brief"
          placeholder="What do you want to advertise?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          header="Budget per post (TON)"
          placeholder="Budget per post in TON (e.g. 5)"
          type="number"
          value={budgetPerPost}
          onChange={(e) => setBudgetPerPost(e.target.value)}
        />
      </Section>

      <Section header="Targeting (optional)">
        <LanguageInput
          header="Target Language"
          placeholder="Target language (e.g. English)"
          value={targetLanguage}
          onChange={setTargetLanguage}
        />
        <Input
          header="Min Subscribers"
          placeholder="Min subscribers (e.g. 1000)"
          type="number"
          value={minSubscribers}
          onChange={(e) => setMinSubscribers(e.target.value)}
        />
      </Section>

      <Section>
        <div style={{ padding: '8px 16px' }}>
          <Button size="l" stretched onClick={handleCreate} loading={saving}>
            Create Campaign
          </Button>
        </div>
      </Section>
    </div>
  );
}
