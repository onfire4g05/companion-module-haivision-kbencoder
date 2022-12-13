import { CreateConvertToBooleanFeedbackUpgradeScript } from '@companion-module/base'

export default [
    CreateConvertToBooleanFeedbackUpgradeScript({
        state: {
            bg: 'bgcolor',
            fg: 'color'
        }
    }),

    function(context, props) {
        const new_feedbacks = props.feedbacks.map(x => {
            if (x.type === 'state') x.options.state = 'running'

            return x
        })

        return {
            updatedConfig: null,
            updatedActions: [],
            updatedFeedbacks: new_feedbacks,
        }
    }
]
