
import { Activity, ActivityGroup } from '../../components/types';

/**
 * Groups consecutive activities of the same type (specifically readings) 
 * into a single ActivityGroup item.
 */
export const groupModuleActivities = (activities: Activity[]): (Activity | ActivityGroup)[] => {
  const grouped: (Activity | ActivityGroup)[] = [];
  
  let currentGroup: ActivityGroup | null = null;

  activities.forEach((activity, index) => {
    // We only group readings for now, as requested
    if (activity.type === 'reading') {
      if (currentGroup && currentGroup.activityType === 'reading') {
        // Continue existing group
        currentGroup.activities.push(activity);
      } else {
        // Start new group
        // If there was a previous group, it's already pushed to 'grouped' by reference, 
        // but let's be explicit:
        currentGroup = {
          type: 'group',
          activityType: 'reading',
          // Use the first activity title as the base, or strip numbers if needed. 
          // For now, simple adoption of the first title is often sufficient context.
          title: activity.title.split(':')[0], 
          activities: [activity]
        };
        grouped.push(currentGroup);
      }
    } else {
      // Non-reading activity
      currentGroup = null; // Break any current group
      grouped.push(activity);
    }
  });

  return grouped;
};
